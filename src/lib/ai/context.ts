import "server-only";
import { activeEnvironment, loadTrades } from "@/lib/analytics/load";
import {
  convictionEdge,
  drawdowns,
  equityCurve,
  groupBy,
  maxDrawdownR,
  streaks,
  summarise,
  type AnalyticsTrade,
} from "@/lib/analytics/stats";
import { DISPLAY_TZ, dayKey, partsIn } from "@/lib/time";
import { mistakeLabel } from "@/lib/journal/taxonomy";
import type { BookId, HorizonId } from "@/lib/books";

/**
 * The factual brief sent to the model.
 *
 * This is the single most important design decision in the AI layer: the model
 * is given PRE-COMPUTED AGGREGATES, never raw rows to do arithmetic on.
 *
 * Language models are unreliable at summing a few hundred numbers, and a
 * confidently wrong P&L figure in a trading journal is worse than no answer at
 * all. Every number the model can quote has already been computed by the same
 * tested functions that render the analytics screens, so a figure in a chat
 * reply and the same figure on the Performance page cannot disagree.
 *
 * The brief is also shown to Peter verbatim in the UI. If an answer looks
 * wrong, the exact input that produced it is one click away.
 */

export type AskContext = {
  brief: string;
  /** Rough size, so the UI can show what a question costs before sending. */
  approxTokens: number;
  trades: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function summaryLine(label: string, s: ReturnType<typeof summarise>): string {
  return (
    `${label}: ${s.trades} trades (${s.independentExits} independent exits), ` +
    `${s.wins}W/${s.losses}L, win rate ${r2(s.winRate)}%, ` +
    `total ${r2(s.totalR)}R, expectancy ${s.expectancyR === null ? "n/a" : `${r2(s.expectancyR)}R`}, ` +
    `net ${r2(s.netPl)}, spread paid ${r2(s.spreadPaid)}`
  );
}

export async function buildAskContext(): Promise<AskContext> {
  const [live, environment] = await Promise.all([
    loadTrades({}),
    activeEnvironment(),
  ]);

  /**
   * With no live account connected, `loadTrades({})` falls back to the practice
   * books — so "live" and "demo" would be the same rows. Asking for both and
   * reporting them separately would tell the model there are twice as many
   * trades as exist. The brief states which environment the figures came from
   * instead.
   */
  const demo = environment === "live" ? await loadTrades({ demo: true }) : [];

  const closed = live.filter((t) => t.exitTime !== null);
  const open = live.filter((t) => t.exitTime === null);

  const overall = summarise(closed);
  const curve = equityCurve(closed);
  const spells = drawdowns(curve).slice(0, 3);
  const st = streaks(closed);

  const byBook = groupBy(closed, (t) => t.book as BookId);
  const byHorizon = groupBy(closed, (t) => t.horizon as HorizonId | null);
  const byInstrument = groupBy(closed, (t) => t.instrument).sort(
    (a, b) => b.summary.totalR - a.summary.totalR,
  );

  const hourOf = (t: AnalyticsTrade) => partsIn(t.entryTime, DISPLAY_TZ).hour;
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const set = closed.filter((t) => hourOf(t) === h);
    return { h, n: set.length, r: summarise(set).totalR };
  }).filter((x) => x.n > 0);

  const byWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => {
    const set = closed.filter((t) => partsIn(t.entryTime, DISPLAY_TZ).weekday === d);
    return { d, n: set.length, r: summarise(set).totalR };
  }).filter((x) => x.n > 0);

  const byMonth = groupBy(closed, (t) =>
    t.exitTime ? dayKey(t.exitTime, DISPLAY_TZ).slice(0, 7) : null,
  ).sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const mistakes = new Map<string, { n: number; r: number }>();
  for (const t of closed) {
    for (const m of t.mistakes) {
      const cur = mistakes.get(m) ?? { n: 0, r: 0 };
      mistakes.set(m, { n: cur.n + 1, r: cur.r + (t.rMultiple ?? 0) });
    }
  }

  const noR = closed.filter((t) => t.rMultiple === null).length;
  const tagged = closed.filter((t) => t.patternId !== null).length;
  const graded = closed.filter((t) => t.processGrade !== null).length;
  const conviction = convictionEdge(closed);

  const lines: string[] = [];

  lines.push("# Peter's trading record — pre-computed figures");
  lines.push("");
  lines.push(
    "Every number below was computed by the application from the OANDA ledger. " +
      "They are facts. Do not recompute them and do not derive new totals by " +
      "adding them together unless the arithmetic is trivial and you state it.",
  );
  lines.push("");

  lines.push("## Coverage and caveats");
  lines.push(`- ${closed.length} closed trades, ${open.length} currently open.`);
  lines.push(
    `- ${overall.independentExits} INDEPENDENT EXITS across those ${closed.length} closed trades. ` +
      `Trades closed in the same minute are one decision expressed as several tickets. ` +
      `Any rate or average below describes roughly ${overall.independentExits} outcomes, not ${closed.length}.`,
  );
  lines.push(
    `- ${noR} closed trades have NO R multiple (no opening stop recorded). They are ` +
      `excluded from every R figure below, and included in every cash figure.`,
  );
  lines.push(
    `- ${tagged} of ${closed.length} closed trades carry a pattern tag; ${graded} carry a process grade.`,
  );
  lines.push(
    `- ${open.length} open positions. ${live.filter((t) => t.exitTime === null && t.rMultiple === null).length} of them have no computable risk.`,
  );
  if (environment === "practice") {
    lines.push(
      "- ⚠️ THESE ARE PRACTICE FIGURES. No live OANDA account is connected, so every " +
        "number below is demo money. Say so if the question implies real money.",
    );
  } else {
    lines.push(
      `- Figures below are LIVE books only. ${demo.filter((t) => t.exitTime).length} closed demo trades exist separately and are NOT included.`,
    );
  }
  lines.push("");

  lines.push(
    `## Overall (${environment === "practice" ? "PRACTICE" : "live"} books, closed trades)`,
  );
  lines.push(`- ${summaryLine("All", overall)}`);
  lines.push(
    `- Profit factor: ${overall.profitFactor === null ? "n/a (nothing lost)" : r2(overall.profitFactor)}`,
  );
  lines.push(
    `- Average win ${overall.avgWinR === null ? "n/a" : `${r2(overall.avgWinR)}R`}, ` +
      `average loss ${overall.avgLossR === null ? "n/a" : `${r2(overall.avgLossR)}R`}, ` +
      `best ${overall.largestWinR === null ? "n/a" : `${r2(overall.largestWinR)}R`}, ` +
      `worst ${overall.largestLossR === null ? "n/a" : `${r2(overall.largestLossR)}R`}`,
  );
  lines.push(`- Max drawdown ${r2(maxDrawdownR(curve))}R`);
  lines.push(
    `- Longest winning streak ${st.longestWin}, longest losing streak ${st.longestLoss}, current ${st.current}`,
  );
  lines.push(`- Financing paid ${r2(overall.financing)}`);
  for (const d of spells) {
    lines.push(
      `- Drawdown: ${r2(d.depthR)}R deep, started ${dayKey(d.startedAt)}, ` +
        `${d.tradesUnderwater} trades underwater, ` +
        (d.recoveredInDays === null
          ? "NOT YET RECOVERED"
          : `recovered in ${r2(d.recoveredInDays)} days`),
    );
  }
  lines.push("");

  lines.push("## By book");
  for (const g of byBook) lines.push(`- ${summaryLine(g.key, g.summary)}`);
  lines.push("");

  lines.push("## By hold time (horizon)");
  for (const g of byHorizon) {
    lines.push(`- ${summaryLine(String(g.key ?? "untagged"), g.summary)}`);
  }
  lines.push("");

  lines.push("## By instrument");
  for (const g of byInstrument) lines.push(`- ${summaryLine(g.key, g.summary)}`);
  lines.push("");

  lines.push("## By entry hour (Europe/London)");
  lines.push(
    byHour.map((x) => `${String(x.h).padStart(2, "0")}:00 n=${x.n} ${r2(x.r)}R`).join(" · "),
  );
  lines.push("");

  lines.push("## By weekday (entry, Europe/London)");
  lines.push(byWeekday.map((x) => `${x.d} n=${x.n} ${r2(x.r)}R`).join(" · "));
  lines.push("");

  lines.push("## By month (exit)");
  for (const g of byMonth) lines.push(`- ${summaryLine(String(g.key), g.summary)}`);
  lines.push("");

  if (conviction.length > 0) {
    lines.push("## Conviction vs outcome");
    for (const c of conviction) {
      lines.push(
        `- ${c.conviction}: n=${c.n}, expectancy ${c.expectancyR === null ? "n/a" : `${r2(c.expectancyR)}R`}`,
      );
    }
    lines.push("");
  }

  if (mistakes.size > 0) {
    lines.push("## Mistake tags (R on trades carrying each tag)");
    lines.push(
      "NOTE: a trade carrying three tags contributes its full result to all three, " +
        "so these sum to more than the total damage. Each is an UPPER BOUND on that leak.",
    );
    for (const [id, v] of [...mistakes.entries()].sort((a, b) => a[1].r - b[1].r)) {
      lines.push(`- ${mistakeLabel(id)}: ${v.n} trades, ${r2(v.r)}R`);
    }
    lines.push("");
  }

  if (open.length > 0) {
    lines.push("## Currently open");
    for (const t of open) {
      lines.push(
        `- ${t.instrument} ${t.direction} on ${t.book}, opened ${dayKey(t.entryTime)}` +
          (t.rMultiple === null ? " — NO STOP RECORDED, risk not computable" : ""),
      );
    }
    lines.push("");
  }

  const brief = lines.join("\n");

  return {
    brief,
    // Rough only — used to show the size of the question, not to bill anything.
    approxTokens: Math.ceil(brief.length / 3.7),
    trades: closed.length,
  };
}
