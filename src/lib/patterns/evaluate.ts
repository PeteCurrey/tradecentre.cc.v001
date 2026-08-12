import {
  adx,
  atr,
  bollinger,
  cci,
  ema,
  keltner,
  lastSwingHigh,
  lastSwingLow,
  macd,
  priorHigh,
  priorLow,
  rsi,
  sma,
  stochastic,
  swingHighs,
  swingLows,
  vwapAnchored,
  type Bar,
} from "@/lib/indicators";
import { SESSIONS, type SessionId } from "@/lib/time";
import type { Condition, SeriesRef } from "./dsl";

/**
 * Deterministic evaluator for the pattern DSL.
 *
 * Two properties this must never violate:
 *
 *   1. NO LOOKAHEAD. Every series at index i depends only on bars 0…i. Swing
 *      points use the confirmed variants, and completed session ranges only
 *      become available after the session has actually ended.
 *
 *   2. SAME RESULT LIVE AND IN BACKTEST. There is one evaluator, used by both.
 *      A pattern cannot behave differently in testing than in production.
 */

const LONDON = "Europe/London";

/** Timezone offset in minutes, cached per UTC hour — DST only shifts on the hour. */
const offsetCache = new Map<number, number>();

function londonOffsetMinutes(timeMs: number): number {
  const hourKey = Math.floor(timeMs / 3_600_000);
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;

  const d = new Date(timeMs);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: LONDON,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = (asUtc - d.getTime()) / 60_000;
  offsetCache.set(hourKey, offset);
  return offset;
}

const nan = (n: number) => new Array<number>(n).fill(NaN);

export class BarContext {
  readonly bars: Bar[];
  readonly n: number;

  /** London-local metadata, precomputed once. */
  readonly hour: number[];
  readonly dow: number[];
  readonly dayIndex: number[];
  private readonly inSession = new Map<SessionId, boolean[]>();

  private seriesCache = new Map<string, number[]>();
  private condCache = new Map<string, boolean[]>();

  constructor(bars: Bar[]) {
    this.bars = bars;
    this.n = bars.length;
    this.hour = new Array(this.n);
    this.dow = new Array(this.n);
    this.dayIndex = new Array(this.n);

    let day = -1;
    let lastKey = "";
    for (let i = 0; i < this.n; i++) {
      const t = bars[i].time;
      const local = new Date(t + londonOffsetMinutes(t) * 60_000);
      this.hour[i] = local.getUTCHours();
      this.dow[i] = local.getUTCDay();
      const key = `${local.getUTCFullYear()}-${local.getUTCMonth()}-${local.getUTCDate()}`;
      if (key !== lastKey) {
        day++;
        lastKey = key;
      }
      this.dayIndex[i] = day;
    }

    for (const s of SESSIONS) {
      const mask = new Array<boolean>(this.n);
      for (let i = 0; i < this.n; i++) {
        const h = this.hour[i];
        mask[i] =
          s.startHour <= s.endHour
            ? h >= s.startHour && h < s.endHour
            : h >= s.startHour || h < s.endHour;
      }
      this.inSession.set(s.id, mask);
    }
  }

  /* ---- Series ---------------------------------------------------------- */

  series(ref: SeriesRef): number[] {
    const key = JSON.stringify(ref);
    const hit = this.seriesCache.get(key);
    if (hit) return hit;
    const value = this.computeSeries(ref);
    this.seriesCache.set(key, value);
    return value;
  }

  private computeSeries(ref: SeriesRef): number[] {
    const b = this.bars;
    const closes = () => b.map((x) => x.c);

    switch (ref.s) {
      case "const":
        return new Array(this.n).fill(ref.value);
      case "open":
        return b.map((x) => x.o);
      case "high":
        return b.map((x) => x.h);
      case "low":
        return b.map((x) => x.l);
      case "close":
        return closes();
      case "hl2":
        return b.map((x) => (x.h + x.l) / 2);
      case "hlc3":
        return b.map((x) => (x.h + x.l + x.c) / 3);
      case "tickVolume":
        return b.map((x) => x.v);

      case "sma":
        return sma(closes(), ref.period);
      case "ema":
        return ema(closes(), ref.period);
      case "rsi":
        return rsi(closes(), ref.period);
      case "atr":
        return atr(b, ref.period);
      case "cci":
        return cci(b, ref.period);

      case "macd": {
        const m = macd(closes(), ref.fast ?? 12, ref.slow ?? 26, ref.signal ?? 9);
        return m[ref.line];
      }
      case "bb":
        return bollinger(closes(), ref.period ?? 20, ref.mult ?? 2)[ref.band];
      case "keltner":
        return keltner(b, ref.period ?? 20, ref.mult ?? 2)[ref.band];
      case "adx":
        return adx(b, ref.period ?? 14)[ref.line];
      case "stoch":
        return stochastic(b, ref.kPeriod ?? 14, ref.dPeriod ?? 3, ref.smooth ?? 3)[ref.line];

      case "swingHigh":
        return lastSwingHigh(b, ref.lookback ?? 2);
      case "swingLow":
        return lastSwingLow(b, ref.lookback ?? 2);
      case "priorHigh":
        return priorHigh(b, ref.period);
      case "priorLow":
        return priorLow(b, ref.period);

      case "dayHigh":
      case "dayLow":
        return this.dayExtreme(ref.s === "dayHigh" ? "high" : "low", ref.which);

      case "sessionHigh":
      case "sessionLow":
        return this.sessionExtreme(
          ref.session,
          ref.s === "sessionHigh" ? "high" : "low",
          ref.which,
        );

      case "vwap":
        return ref.anchor === "day"
          ? vwapAnchored(b, (_, i) => i === 0 || this.dayIndex[i] !== this.dayIndex[i - 1])
          : vwapAnchored(b, (_, i) => i === 0 || this.hour[i] === 8 && this.hour[i - 1] !== 8);

      case "abs":
        return this.series(ref.a).map(Math.abs);

      case "offset": {
        const src = this.series(ref.a);
        const out = nan(this.n);
        for (let i = ref.bars; i < this.n; i++) out[i] = src[i - ref.bars];
        return out;
      }

      case "add":
      case "sub":
      case "mul":
      case "div": {
        const a = this.series(ref.a);
        const bb = this.series(ref.b);
        const out = nan(this.n);
        for (let i = 0; i < this.n; i++) {
          if (Number.isNaN(a[i]) || Number.isNaN(bb[i])) continue;
          out[i] =
            ref.s === "add"
              ? a[i] + bb[i]
              : ref.s === "sub"
                ? a[i] - bb[i]
                : ref.s === "mul"
                  ? a[i] * bb[i]
                  : bb[i] === 0
                    ? NaN
                    : a[i] / bb[i];
        }
        return out;
      }
    }
  }

  /** Running day extreme, or the completed previous day's. */
  private dayExtreme(kind: "high" | "low", which: "current" | "previous"): number[] {
    const out = nan(this.n);
    const finals: number[] = [];
    let running = kind === "high" ? -Infinity : Infinity;

    for (let i = 0; i < this.n; i++) {
      if (i > 0 && this.dayIndex[i] !== this.dayIndex[i - 1]) {
        finals[this.dayIndex[i - 1]] = running;
        running = kind === "high" ? -Infinity : Infinity;
      }
      const v = kind === "high" ? this.bars[i].h : this.bars[i].l;
      running = kind === "high" ? Math.max(running, v) : Math.min(running, v);

      if (which === "current") {
        out[i] = running;
      } else {
        const prev = finals[this.dayIndex[i] - 1];
        out[i] = prev === undefined ? NaN : prev;
      }
    }
    return out;
  }

  /**
   * Session extreme.
   *
   * `completed` returns the most recent session instance that has FULLY ENDED.
   * This is the correct reference for range-break patterns — using a range that
   * is still forming would be reading the future.
   */
  private sessionExtreme(
    session: SessionId,
    kind: "high" | "low",
    which: "current" | "completed",
  ): number[] {
    const mask = this.inSession.get(session);
    const out = nan(this.n);
    if (!mask) return out;

    let running = kind === "high" ? -Infinity : Infinity;
    let lastCompleted = NaN;

    for (let i = 0; i < this.n; i++) {
      const wasIn = i > 0 && mask[i - 1];
      // Freeze BEFORE assigning this bar, so the value is available only from
      // the first bar after the session ends.
      if (wasIn && !mask[i]) {
        lastCompleted = Number.isFinite(running) ? running : NaN;
        running = kind === "high" ? -Infinity : Infinity;
      }
      if (mask[i]) {
        const v = kind === "high" ? this.bars[i].h : this.bars[i].l;
        running = kind === "high" ? Math.max(running, v) : Math.min(running, v);
      }
      out[i] =
        which === "current"
          ? mask[i] && Number.isFinite(running)
            ? running
            : NaN
          : lastCompleted;
    }
    return out;
  }

  /* ---- Conditions ------------------------------------------------------ */

  evaluate(cond: Condition): boolean[] {
    const key = JSON.stringify(cond);
    const hit = this.condCache.get(key);
    if (hit) return hit;
    const value = this.computeCondition(cond);
    this.condCache.set(key, value);
    return value;
  }

  private computeCondition(cond: Condition): boolean[] {
    const out = new Array<boolean>(this.n).fill(false);

    switch (cond.c) {
      case "cmp": {
        const l = this.series(cond.left);
        const r = this.series(cond.right);
        for (let i = 0; i < this.n; i++) {
          if (Number.isNaN(l[i]) || Number.isNaN(r[i])) continue;
          out[i] =
            cond.op === ">"
              ? l[i] > r[i]
              : cond.op === ">="
                ? l[i] >= r[i]
                : cond.op === "<"
                  ? l[i] < r[i]
                  : l[i] <= r[i];
        }
        return out;
      }

      case "cross": {
        const l = this.series(cond.left);
        const r = this.series(cond.right);
        for (let i = 1; i < this.n; i++) {
          if (
            Number.isNaN(l[i]) || Number.isNaN(r[i]) ||
            Number.isNaN(l[i - 1]) || Number.isNaN(r[i - 1])
          ) {
            continue;
          }
          out[i] =
            cond.dir === "above"
              ? l[i - 1] <= r[i - 1] && l[i] > r[i]
              : l[i - 1] >= r[i - 1] && l[i] < r[i];
        }
        return out;
      }

      case "session": {
        const masks = cond.sessions
          .map((s) => this.inSession.get(s))
          .filter(Boolean) as boolean[][];
        for (let i = 0; i < this.n; i++) out[i] = masks.some((m) => m[i]);
        return out;
      }

      case "timeOfDay": {
        for (let i = 0; i < this.n; i++) {
          const h = this.hour[i];
          out[i] =
            cond.afterHour <= cond.beforeHour
              ? h >= cond.afterHour && h < cond.beforeHour
              : h >= cond.afterHour || h < cond.beforeHour;
        }
        return out;
      }

      case "dayOfWeek": {
        const set = new Set(cond.days);
        for (let i = 0; i < this.n; i++) out[i] = set.has(this.dow[i]);
        return out;
      }

      case "within": {
        const a = this.series(cond.a);
        const b = this.series(cond.b);
        const tol = this.series(cond.tolerance);
        for (let i = 0; i < this.n; i++) {
          if (Number.isNaN(a[i]) || Number.isNaN(b[i]) || Number.isNaN(tol[i])) continue;
          out[i] = Math.abs(a[i] - b[i]) <= tol[i];
        }
        return out;
      }

      case "sweepReclaim": {
        const level = this.series(cond.level);
        for (let i = 0; i < this.n; i++) {
          if (Number.isNaN(level[i])) continue;
          const start = Math.max(0, i - cond.withinBars + 1);

          let swept = false;
          for (let j = start; j <= i; j++) {
            if (cond.dir === "above" ? this.bars[j].h > level[i] : this.bars[j].l < level[i]) {
              swept = true;
              break;
            }
          }
          if (!swept) continue;

          // Reclaimed: closed back on the original side of the level.
          out[i] =
            cond.dir === "above" ? this.bars[i].c < level[i] : this.bars[i].c > level[i];
        }
        return out;
      }

      case "divergence": {
        const lookback = cond.swingLookback ?? 2;
        const validFor = cond.validForBars ?? 3;
        const maxSpan = cond.maxSpanBars ?? 60;
        const ind = this.series(cond.indicator);
        const isSwing =
          cond.kind === "bullish"
            ? swingLows(this.bars, lookback)
            : swingHighs(this.bars, lookback);

        // Walk forward, only ever acting at the bar a swing becomes CONFIRMED.
        let prevSwing = -1;
        for (let i = 0; i < this.n; i++) {
          const confirmedIdx = i - lookback;
          if (confirmedIdx < 0 || !isSwing[confirmedIdx]) continue;

          if (prevSwing >= 0 && confirmedIdx - prevSwing <= maxSpan) {
            const p1 =
              cond.kind === "bullish" ? this.bars[prevSwing].l : this.bars[prevSwing].h;
            const p2 =
              cond.kind === "bullish" ? this.bars[confirmedIdx].l : this.bars[confirmedIdx].h;
            const i1 = ind[prevSwing];
            const i2 = ind[confirmedIdx];

            if (!Number.isNaN(i1) && !Number.isNaN(i2)) {
              const diverged =
                cond.kind === "bullish" ? p2 < p1 && i2 > i1 : p2 > p1 && i2 < i1;
              if (diverged) {
                for (let k = i; k < Math.min(this.n, i + validFor); k++) out[k] = true;
              }
            }
          }
          prevSwing = confirmedIdx;
        }
        return out;
      }

      case "consecutive": {
        const inner = this.evaluate(cond.of);
        for (let i = cond.bars - 1; i < this.n; i++) {
          let all = true;
          for (let j = i - cond.bars + 1; j <= i; j++) {
            if (!inner[j]) {
              all = false;
              break;
            }
          }
          out[i] = all;
        }
        return out;
      }

      case "withinBars": {
        const inner = this.evaluate(cond.of);
        for (let i = 0; i < this.n; i++) {
          const start = Math.max(0, i - cond.bars + 1);
          for (let j = start; j <= i; j++) {
            if (inner[j]) {
              out[i] = true;
              break;
            }
          }
        }
        return out;
      }

      case "all": {
        const parts = cond.of.map((c) => this.evaluate(c));
        for (let i = 0; i < this.n; i++) out[i] = parts.every((p) => p[i]);
        return out;
      }

      case "any": {
        const parts = cond.of.map((c) => this.evaluate(c));
        for (let i = 0; i < this.n; i++) out[i] = parts.some((p) => p[i]);
        return out;
      }

      case "not": {
        const inner = this.evaluate(cond.of);
        for (let i = 0; i < this.n; i++) out[i] = !inner[i];
        return out;
      }
    }
  }
}

/** Indices at which a pattern's trigger fires. */
export function signalIndices(bars: Bar[], trigger: Condition): number[] {
  const ctx = new BarContext(bars);
  const fired = ctx.evaluate(trigger);
  const out: number[] = [];
  for (let i = 0; i < fired.length; i++) if (fired[i]) out.push(i);
  return out;
}
