# Personal Trading Dashboard — Implementation Plan

> **Working dir:** `/Users/petercurrey/Desktop/Trader Platform CC V001` (greenfield — empty)
> **Status:** Design complete across 14 question rounds. Ready to build.
> **One outstanding input:** Peter's actual trading patterns (content, not a decision — see §9)

---

## 1. Context

Peter wants a personal trading dashboard — "my own TraderVue, unique to the stuff that matters to
me." He updates it daily with the trades he took and the best opportunities of the day, and wants
substantially more than a journal: a live desk, a pattern library that the system actively uses, an
AI layer over his own trading data, and market context his broker doesn't provide.

He trades **FX, indices, commodities and crypto — all as OANDA CFDs** — across four horizons
(scalp, intraday, swing, position), each in its own OANDA sub-account. He always uses hard stop
orders, which means R-multiples, planned risk and MAE/MFE all derive automatically from broker data
with no manual entry.

The visual reference is a dark "Phoenix / ZEUS-X" energy dashboard: near-black cards on charcoal, a
single vivid orange accent, large condensed uppercase display type, pill toggles, radial gauges and
flowing gradient ribbons.

**Why this rather than TraderVue:** TraderVue can't stream his live account, can't run a pattern
library that scans, can't reason over his history in plain English, and has no concept of
market-implied event probabilities. Everything distinctive here comes from combining his broker
feed, his own pattern definitions, and his API keys.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Railway (single always-on Node process)                     │
│                                                              │
│  Next.js (App Router, TS)  ──  custom Node server + ws       │
│         │                              │                     │
│    Server routes                 WebSocket push              │
│         │                              │                     │
│  ┌──────┴──────────────────────────────┴──────┐             │
│  │  OANDA client   │  Indicator engine        │             │
│  │  Pattern scanner│  AI router (4 providers) │             │
│  └──────┬──────────────────────────────┬──────┘             │
│         │                              │                     │
└─────────┼──────────────────────────────┼─────────────────────┘
          │                              │
   Railway Postgres              OANDA v20 REST + streams
                                 Finnhub · FRED · Polymarket
```

**Stack:** Next.js 15 (App Router) + TypeScript · custom Node server hosting both Next and a `ws`
WebSocket server · Postgres via Drizzle ORM · TailwindCSS · TradingView Lightweight Charts · Zod.

**Why a custom server:** WebSocket push requires a long-lived process. Next.js in Node mode with a
custom server gives one deployment, one codebase, one bill. It disables automatic static
optimisation, which is irrelevant for a private single-user dashboard.

**No job scheduler in v1** — AI runs on demand only, so there is nothing to schedule.

### Connection budget
- **1** shared live pricing stream (prices are identical across sub-accounts)
- **4** live transaction streams, one per book
- Demo streams connect **lazily**, only while actively testing — not 8 permanent connections

### 🔒 Security constraints (non-negotiable)
- OANDA personal access tokens are **full trading credentials** — the API has no read-only scope
- **Two tokens required:** live (`api-fxtrade`) and practice (`api-fxpractice`) are separate systems
- Tokens live in server-side env vars only — never in the client bundle, never in `NEXT_PUBLIC_*`
- All OANDA calls proxied through server routes; the browser never sees a token
- **Read endpoints exclusively. No order placement, no position modification, ever.**
- Single-user auth: password + signed httpOnly session cookie

---

## 3. Data model (Postgres / Drizzle)

| Table | Purpose |
|---|---|
| `accounts` | OANDA account id → book, environment (live/practice), currency |
| `books` | scalp/intraday/swing/position · base risk % · daily R limit · conviction multipliers |
| `instruments` | Name, type, pip location, display precision — seeded from `/instruments` |
| `transactions_raw` | Raw OANDA ledger, idempotent on transaction id. **Source of truth.** |
| `trades` | Derived: entry/exit, size, planned stop & target, realised P&L, financing, MAE, MFE, R-multiple, book |
| `trade_annotations` | Pattern, conviction (A+/A/B/C), process grade, mistakes[], reasoning, notes |
| `patterns` | Name, tags[], trigger rules (jsonb), invalidation, context filters (jsonb), target/management logic, status (live/incubating) |
| `pattern_examples` | Pinned best and worst instances per pattern |
| `opportunities` | Date, instrument, source (spotted/ai/engine), score, reasoning, taken?, linked trade |
| `daily_plans` | Bias, key levels, setups hunted, A+ conditions |
| `daily_reviews` | Grade, adherence, notes, AI draft |
| `state_logs` | Sleep/energy/focus (1–5), emotion pre/during/post, tilt markers[] |
| `candles` | Cached OHLC windows around every trade — permanent |
| `watchlist_levels` | Tracked instruments and marked levels |
| `alerts` | Rule, severity, channel routing, state |
| `ai_runs` | Task, model, tokens, **cost** — so AI spend is visible, not a surprise |
| `macro_events` | Finnhub calendar cache + FRED series + Polymarket probabilities |

**Key derivation:** trades are *derived* from `transactions_raw`, never edited directly. Re-running
derivation is always safe and idempotent, so a bug in trade-building is fixable by replaying the
ledger rather than by data surgery.

**Timestamps:** stored UTC canonically, rendered Europe/London. Day-boundary rule is a per-view
display setting — see §8.

---

## 4. The 24 screens

```
LIVE       Today / Live Desk ★landing  ·  Open Positions
DAILY      Pre-Market Game Plan · Best Opportunities · End of Day Review · Calendar Heatmap
TRADES     Trade Log / Blotter · Pattern Library   (Trade Detail = drill-down)
ANALYTICS  Performance & Equity · Pattern Performance · Time & Session · Instrument Analysis
RISK       Risk & Drawdown · Mistakes & Leaks · Playbook & Rules
RESEARCH   Market Context & Calendar · Watchlist & Levels · Idea Lab · Goals & Progress
REVIEW     Psychology & State · Reports & Exports
SETTINGS   Accounts · Books · Risk config · Models · Display
```

**Navigation:** grouped collapsible left sidebar + ⌘K command palette. The reference's flat 4-tab
bar does not survive 24 screens; the *visual* language does.

**Account switcher** (top bar): four live books · **All Live** roll-up · demo accounts.
Demo never joins any aggregate.

### Three screens worth specifying now

**Today / Live Desk** — the hero, and where the reference maps most directly:
- Dominant figure: **today's R against the daily limit**, driving a radial gauge (the reference's
  charging meter). Cash P&L as a large secondary readout.
- Capital-at-risk by book rendered as the reference's flowing ribbons — one ribbon per book,
  orange where live risk is on, grey where flat.
- Open positions with streaming P&L; watchlist prices; AI candidates panel.

**Best Opportunities of the Day** — everything spotted plus every AI candidate, scored and
source-labelled. Its real output is the **three-way comparison over time: what Peter spotted, what
the AI spotted, what he actually traded.** That comparison measures selection quality (not just
execution) and is the honest test of whether the AI is worth listening to at all.

**Pattern Library** — flat list, multi-dimensional tags (book · condition · instrument · timeframe).
Each pattern holds: mechanical trigger + invalidation · context filters · target & management logic ·
live stats and pinned examples. Trades are tagged by the engine at entry and confirmed by Peter in
one click.

---

## 5. The intelligence layer

### Indicator engine (deterministic, in-house)
Computed from OANDA candles — **not** sourced from TradingView, which has no public API for
indicator data.

| Family | Indicators |
|---|---|
| Trend | EMA/SMA + crosses, MACD (line/signal/histogram), ADX |
| Momentum | RSI, Stochastic, CCI, divergence detection |
| Volatility | ATR, Bollinger, Keltner |
| Structure | Swing H/L, prior day & session H/L, round numbers, VWAP |

ATR does double duty: volatility-regime classification, and normalising stop distances across
instruments as different as EURUSD and XAUUSD.

### Pattern scanning — the split that works
- **Deterministic code** handles geometry: swing points, ranges, engulfing bars, ATR conditions,
  session boundaries, level proximity. Fast, free, reproducible, testable.
- **The LLM** handles judgement: weighing conflicting context, comparing against historical
  instances, explaining why this one is better or worse than usual.

> LLMs are unreliable at reading raw OHLC arrays — they hallucinate structure and aren't
> reproducible run to run. Building detection on "send candles and ask what you see" would produce
> a feature that demos well and can't be trusted with money.

### AI features (all on demand — no scheduled or continuous jobs)
Draft the EOD review · grade execution against the Playbook · rank trade candidates from indicator
state · conversational Q&A over trade history · pre-market brief · pre-trade sanity check ·
voice/dictated journaling · weekly & monthly meta-analysis.

**Model routing:** per-task selection in Settings with sensible defaults — strong reasoning models
for long-form review and meta-analysis, cheap fast models for classification. Every call logged to
`ai_runs` with token cost.

### Scope boundary on trade suggestions
The scanner ranks candidates against **Peter's own** patterns, indicator conditions and history, and
explains its reasoning. It is not investment advice, it never places orders, and an LLM's read of a
chart is not an edge on its own — the value is consistency and speed of filtering, not prediction.

---

## 6. External data

| Source | Role | Confidence |
|---|---|---|
| **OANDA** | Source of truth: fills, positions, account, candles, streaming | Locked |
| **Finnhub** | Economic calendar + news | ⚠️ Calendar historically paid-tier — **verify first** |
| **Twelve Data** | Calendar fallback; backup prices | Fallback |
| **FRED** | Macro series for volatility-regime context. Free, reliable | High |
| **Polymarket** | Market-implied event probabilities beside calendar events | Medium |
| **Polygon** | News; backup price source | Medium |
| **Databento** | ⚠️ Doesn't cover FX CFDs — **poor fit**, excluded unless Peter has a reason | Excluded |
| **SEC EDGAR** | ⚠️ Little relevance to FX/indices/commodities — **excluded** for now | Excluded |

**Verify before building:** confirm what Peter's actual Finnhub tier returns rather than trusting
documentation. Twelve Data is the fallback if the calendar endpoint is gated.

**⚠️ OANDA volume caveat:** FX has no centralised volume — OANDA's `volume` field is *tick count*.
VWAP and any volume-derived indicator must be labelled tick-derived. Same for index/commodity CFDs.

---

## 7. Build phases

**Phase 1 — Data spine** *(nothing else is real until this works)*
Repo scaffold · design system shell · auth · Postgres + Drizzle · OANDA client with dual-token
host routing · account→book mapping · transaction sync + idempotent trade derivation ·
**Trade Log** · **Live Desk** with streaming · **Open Positions**.

**Phase 2 — The daily loop**
Pre-Market Game Plan · Best Opportunities · End of Day Review · Trade Detail with Lightweight
Charts and cached candles · Calendar Heatmap · state logging.

**Phase 3 — Patterns & analytics**
Pattern Library · engine-suggested tagging · Pattern Performance · Performance & Equity Curves ·
Time & Session · Instrument Analysis (incl. correlation exposure) · Risk & Drawdown · Mistakes & Leaks.

**Phase 4 — Intelligence**
Indicator engine · pattern scanner · AI router + all AI features · voice journaling.

**Phase 5 — Context & the rest**
Market Context (Finnhub/FRED/Polymarket) · Watchlist & alerts (4 channels) · Idea Lab ·
Playbook & Rules · Goals · Reports & Exports.

---

## 8. Design system

Derived from the Phoenix reference, at roughly **2× its information density** — same cards, palette
and display numerals, but a tighter type scale and reduced padding so 24 screens actually work.

| Token | Value |
|---|---|
| Background | Deep charcoal `~#141416`, subtle dot texture |
| Cards | Near-black, ~20–24px radius, very low-contrast borders |
| **Orange** `~#FF5A0A` | **UI accent only** — active state, live indicators, selection |
| **Green / red** | **Money only** — P&L and nothing else, so a red number is never ambiguous |
| Neutrals | Cool greys inactive; near-white for primary values |
| Type | Condensed uppercase display headings · small-caps labels · large numerals |
| Controls | Pill toggles, radial gauges, flowing gradient ribbons |

The strict separation of orange (interface) from green/red (money) is what lets the reference's
single-accent character survive in a P&L context.

**Day boundary:** OANDA rolls the trading day at 17:00 New York, which is when financing is
charged — so London-midnight days won't tie exactly to OANDA statements. Irrelevant intraday;
visible on swing/position trades carrying financing. Handled as a per-view display setting.

---

## 8b. Pattern generation & backtesting *(added after build started)*

Peter has **no existing patterns** — he wants them generated as a basis for building strategies.
This turns the Pattern Library from a record of what he already does into a **hypothesis backlog**,
which is a better fit for the Idea Lab than originally assumed.

**Framing, stated explicitly:** these are candidates, not edges. Every one is drawn from public
technical literature; none is known to be profitable on his instruments, with his costs, in current
conditions. They exist to be measured. Nothing is Claude recommending a trade.

| Decision | Choice |
|---|---|
| Families | All four: liquidity/structure, classical price action, indicator-based, session/time |
| Volume | **20 patterns**, five per book |
| Precision | **Fully mechanical** — every condition computable, so all can be backtested objectively |
| Testing | **Backtest → demo → live** |

### The pipeline
```
generated (incubating) → backtest → demo book → Idea Lab threshold → Peter approves → live
```

### ⚠️ Multiple-testing hazard
Testing ~20 patterns against one dataset produces winners by chance — with 20 tries, something
clears p<0.05 roughly two times in three even if nothing works. Peter chose plain backtesting over
walk-forward validation. The engine therefore reports **out-of-sample results alongside full-period
by default** — a train/test split, not the walk-forward feature he declined. Without it the numbers
actively mislead. Flagged to Peter, who may turn it off.

### Consequence: candle caching revised (supersedes decision #59)
Backtesting needs **full history per instrument**, not just windows around trades.
- Permanent windows around every trade — kept, this is what makes old charts reproducible
- **Plus** a bulk historical store for instruments under test

### Pattern DSL
Patterns are stored as **JSON in `patterns.trigger_rules`**, not as code, so one definition drives
both the live scanner and the backtester. A pattern cannot behave differently in testing than in
production — the usual way backtest results stop meaning anything.

Two invariants, both enforced by tests:
1. **No lookahead.** Every series at bar *i* depends only on bars 0…*i*. Swing points use confirmed
   variants; completed session ranges publish only after the session ends. Verified by a property
   test comparing full-array evaluation against truncated-array evaluation across 11 series types.
2. **One evaluator**, shared by scanner and backtester.

Divergence detection was added to the DSL (Peter selected it in Round 9); it necessarily lags, since
both swings must be confirmed.

---

## 8c. OANDA connectivity verified *(practice)*

Practice token authenticated successfully; 401 on live, as expected for a demo token.

| Finding | Detail |
|---|---|
| Instruments | **123** — 68 CURRENCY, 34 CFD, 21 METAL |
| Indices | SPX500_USD, NAS100_USD, US30_USD, UK100_GBP, DE30_EUR, JP225_USD, JP225Y_JPY |
| Commodities/metals | XAU/XAG across many crosses, WTICO_USD, BCO_USD, NATGAS_USD, CORN_USD, SUGAR_USD |
| **Crypto CFDs** | ❌ **NONE AVAILABLE** — resolves the Round 2 open question. Crypto drops from scope or becomes manual-entry-only |
| Account `-001` | £98,611 NAV, 0 open trades, lastTransactionID 2111 |
| Accounts `-002/-003/-004` | ⚠️ **403 forbidden** — token only grants access to `-001`. Needs regenerating in OANDA → Manage API Access, after the sub-accounts existed |

### Database — revised (supersedes decision #58)
Peter had already provisioned Supabase, so:
- **Supabase Postgres**, app still on **Railway**
- Schema unchanged — it is plain Postgres, so Drizzle is unaffected
- ⚠️ Supabase's **transaction pooler (:6543) does not support prepared statements**, which
  postgres.js uses by default. The client detects the port and sets `prepare: false` accordingly.
  Session pooler (:5432) is preferred for a persistent Node process.

### Service verification — all keys tested live

| Service | Status |
|---|---|
| **Supabase Postgres** | ✓ connected, PostgreSQL 17.6, no tables yet |
| **OANDA practice** | ✓ **4/4 accounts readable** after token regeneration |
| **FRED** | ✓ series + **release calendar** both working |
| **EIA** | ✓ US petroleum & natural gas inventories |
| **Polygon** | ✓ |
| **Polymarket** | ✓ public API, no key required |
| **Twelve Data** | ✓ quotes only — **no economic calendar exists** (404) |
| **Finnhub** | ⚠️ quotes ✓, **economic calendar 403 — tier-gated** |
| **Anthropic / OpenAI / Gemini** | ✓ valid |
| **xAI / Grok** | ⚠️ key valid but **team has no credits** — needs purchasing |

Accounts: `-001` £98,611 (lastTxn 2111, real history) · `-002/-003/-004` £100,000 each (fresh).

### Calendar resolution (supersedes decision #27)
Finnhub's calendar is gated and **Twelve Data has no calendar endpoint at all**, so:
- **FRED release calendar** — US macro dates & names (CPI, NFP, Fed). No consensus figures.
- **EIA** — weekly petroleum status (Wed) and natural gas storage (Thu). Directly relevant to
  WTICO/BCO/NATGAS, which Peter trades.
- **Twelve Data** demoted to backup price source.
- Gap accepted: no forecast/actual/previous consensus numbers, and thin UK/EU coverage.

### Env key aliases
`env.ts` accepts common alias spellings per canonical key (e.g. `GOOGLE_GEMINI_KEY` → `GEMINI_API_KEY`,
`TWELVE_DATA_KEY` → `TWELVEDATA_API_KEY`, `OANDA_API_KEY` → `OANDA_PRACTICE_TOKEN`). Costs nothing
and removes a whole category of "why is this empty" debugging. Validation errors list the accepted
names for the failing key.

### Keys present but not used (assessed, deliberately excluded)
| Key | Reason |
|---|---|
| `TAAPI_API_KEY` | Indicators as a service. We compute in-house — free, no rate limits, reproducible, already tested. Using it would be strictly worse. |
| `ALPHA_VANTAGE_KEY` | Redundant against Polygon + Twelve Data; very restrictive free tier. |
| `Quiver_API_KEY` | Congressional/insider equity data. No bearing on FX, index or commodity CFDs. |
| `COMPANIES_HOUSE_API_KEY` | UK company filings. Not relevant to this instrument set. |

### Data access — server-side only
The browser never talks to Postgres directly; everything goes through server routes, exactly as
the OANDA token does. One security model for the whole app, and no RLS policy that can be
misconfigured into exposing the trade history.

Enforced by tests: no `NEXT_PUBLIC_` anywhere in `src/`, and no client component may import
`@/lib/db` or `@/lib/env`.

---

## 8d. Streaming — SSE instead of WebSockets *(supersedes the custom-server plan)*

The plan called for a custom Node server hosting Next plus a `ws` server. That conflicts with the
`server-only` guard: outside Next's `react-server` condition, `server-only` resolves to a throwing
build, so a standalone server cannot import the OANDA client without weakening the guard that keeps
the token off the client.

**Server-Sent Events are a better fit and avoid the conflict entirely:**
- the feed is one-way — the browser only ever receives ticks
- it runs in an ordinary route handler, so `server-only` stays intact
- `EventSource` reconnects on its own
- no custom server, so `next dev` / `next start` work unchanged

Still requires an always-on host — a serverless platform would cut the response at its function
timeout. Railway remains the answer; Vercel remains ruled out.

Architecture: `instrumentation.ts` opens ONE OANDA pricing stream at process boot; `hub.ts` fans it
out to every connected browser; `/api/stream` serves SSE behind the session guard.

### ⚠️ Three real bugs found and fixed during this work
| Bug | Consequence |
|---|---|
| **Trailing stop moved above market** | `max(stop, ema50)` for a long put the stop above price, so the next bar "stopped out" better than the market ever traded. Turned losers into winners — `position-long-term-sweep` read **+151R** instead of **+0.19R**. Regression test added. |
| **`after()` closed the SSE stream** | Fires once headers are sent, so the feed delivered only its initial snapshot and nothing after. |
| **`requestAnimationFrame` batching** | Paused in background tabs — a backgrounded dashboard would silently stop updating while still showing "LIVE". Replaced with a 100ms timer. |

### ⚠️ Spreads were measured, not guessed (supersedes the estimates)
Displaying `closeoutBid`/`closeoutAsk` was wrong — those are OANDA's margin-closeout prices, the far
end of the book. On XAU_USD closeout reads ~20 points against a top-of-book spread of ~0.75.

Measured, London session, 12 Aug 2026:
`EUR_USD 0.00006` · `GBP_USD 0.00012` · `USD_JPY 0.014` · `XAU_USD 0.85` · `SPX500 0.50` ·
`NAS100 2.2` · `WTICO 0.030`

Backtest defaults were wrong in both directions — XAU assumed 0.35 vs actual ~0.74, NAS100 assumed
1.2 vs actual ~3.0. Both understatements flattered patterns on the instruments that looked best.
Corrected and re-run.

### Backtest after cost correction
```
scalp      −0.198   0/10 positive
intraday   −0.403   1/7  positive
swing      +0.096   5/9  positive
position   +0.002   3/6  positive
```
Eight combinations remain positive out-of-sample. Scalp remains 0-for-10.

---

## 8e. TradingView corpus & the English→pattern compiler *(added Aug 2026)*

Three things Peter asked for: pull good indicators and strategies from TradingView into the
project, backtest them and cull the bad ones, and be able to describe a strategy in plain English
and have it built. The audit below changed the shape of all three, mostly by finding that we had
already built more than expected.

### What already exists (audited, not assumed)

| Piece | Status |
|---|---|
| Indicator library | ✅ `src/lib/indicators/` — 14 indicators, Wilder-correct, NaN-padded, tested |
| Strategy representation | ✅ `PatternDef` JSON DSL — *this is the constrained DSL, already built* |
| Backtest engine | ✅ `src/lib/backtest/engine.ts` — next-bar entry, stop-wins ties, measured costs, IS/OOS split |
| Shared evaluator | ✅ One `BarContext` drives scanner and backtester |
| Pattern → English | ✅ `describe.ts` — `describeSeries/Condition/Trigger/Stop/Target` |
| Candle history | ✅ `src/lib/candles/service.ts` + bulk store (#64) |

So the backtester Peter asked for **is not a new build**. The gap is narrower and more specific:
a source of candidate strategies, a way to translate them in, a statistical gate strong enough for
the volume, and the English→`PatternDef` direction.

### The MCP server — audited, approved for local use

`daviddme/tradingview-indicator-search-mcp-server`, MIT, ~1,880 lines across 9 files.

Audit findings:
- **Network egress is two hosts only** — `www.tradingview.com` and `pine-facade.tradingview.com`.
  No telemetry, no third host.
- **No `child_process`, no `eval`, no `new Function`, no arbitrary filesystem writes.** The only
  `exec` calls are `db.exec` on SQLite pragmas and schema.
- **Two dependencies**, both mainstream: `@modelcontextprotocol/sdk`, `zod`.
- `process.env` read only for the documented `IF_*` config variables.
- Throttle is enforced at the HTTP layer, not per-tool, so no tool can bypass it. Circuit breaker
  after 3 consecutive blocks; 2,000/day hard budget.
- Its own `NOTICE.md` states plainly that harvested Pine remains its authors' copyright.

**Verdict: safe to install locally.** Run on the residential connection, never from a host.

### The corpus is a reference cache, not project data

A hard boundary, because getting this wrong would corrupt the data model:

```
TradingView → SQLite corpus (gitignored, disposable, re-harvestable)
                   ↓  supervised translation, human in the loop
              PatternDef JSON  ←──── English→pattern compiler
                   ↓
              existing backtest engine
                   ↓  walk-forward gate
              curated library  →  manual promotion  →  autonomous engine
```

The corpus **never** enters Postgres, never joins `transactions_raw`, and is never a dependency of
anything that renders. If it is deleted, we re-harvest and nothing is lost.

Realistic volume: 1.5–4.5s jittered delay plus a 20–60s break every 25 requests, and
`IF_HARVEST_MAX` caps a run at 200. Practical ceiling is **~500–1,500 scripts/day**. "Hundreds of
thousands" is the size of the haystack, not of the take. Harvesting is targeted from the start.

### ⚠️ Two hazards that decide whether this is worth doing

**1. The multiple-testing problem gets an order of magnitude worse.**

§8b flagged this at 20 patterns, and Peter chose plain backtesting over walk-forward; the engine's
IS/OOS split was the compromise. **That compromise does not survive this change.** At 20 patterns a
train/test split is a reasonable guard. At 300 harvested candidates, a single 30% holdout is not a
guard at all — with 300 tries, several will clear any fixed OOS threshold on luck alone, and they
will then carry the specific false authority of having "passed out-of-sample."

Screening hundreds and keeping the best ten is *a procedure that manufactures false winners*. It
would be worse than not building it, because the survivors reach an autonomous engine that can
place real orders.

So harvesting at volume requires, as a precondition, not an enhancement:
- **Walk-forward** with multiple non-overlapping windows, replacing the single tail split
- **An explicit tested-count**, recorded per screening run, with the pass threshold adjusted for it
- **Consistency across windows** as the criterion, not aggregate performance

Expected yield from a few hundred candidates: **a small handful, possibly none.** A screen that
usually returns nothing is working. One that keeps finding winners is broken.

**2. TradingView's population is adversely selected.**

Public scripts skew heavily toward curve-fitted and — critically — **repainting** logic: lookahead
via `security()`, signals that redraw on the closed bar. Many of the most popular strategies look
superb on TradingView precisely because they are peeking.

Our translation kills this by construction: `PatternDef` cannot express lookahead, entry is the next
bar's open, and swings are confirmed-only. That is the right outcome, but it has a consequence worth
stating — **a script's TradingView performance carries no information about its real quality**, so
popularity and stars are discovery signals only, never evidence. The corpus is a source of *ideas*,
not of *results*.

### Translation is the bottleneck, and it is human-supervised

Pine → `PatternDef` is not mechanical. Pine's bar-by-bar series model, `security()` semantics and
`barstate` handling have no clean mapping. Anything the DSL cannot express is **rejected, not
approximated** — a strategy silently simplified into the DSL is not the strategy that was tested.
Each translation lands with its source URL and author credited in the header, per MPL-2.0 and the
server's own NOTICE.

### English → PatternDef

`describe.ts` already renders `PatternDef` → English. This is the inverse, and the round trip is
what makes it trustworthy: Peter describes a strategy, it compiles to `PatternDef`, and
`describeTrigger` renders it **back** to English for confirmation before anything runs. If the
read-back doesn't match his intent, the compile was wrong and he sees it immediately.

Compiling to the DSL rather than generating code is what makes this safe: the output is
type-checked, storable as JSON, incapable of expressing lookahead, and runs through the same
evaluator as everything else. Same gate as any other pattern — no exemption for being Peter's idea.

### Sequence

1. Install + wire the MCP (audited above); corpus path gitignored
2. **Walk-forward + tested-count in the engine** — precondition, before any bulk screening
3. Targeted harvest; `query_corpus` to shortlist by source content
4. Supervised Pine → `PatternDef` translation, each with a golden test
5. Screen through the gate; retain rejects with results rather than deleting, so the same idea
   isn't re-tested in six months
6. English→`PatternDef` compiler with `describe.ts` read-back confirmation
7. Promotion to live stays a manual act by Peter — never automatic on a passing backtest

### Instruments and history — resolved, and verified live

Peter's traded universe: **NAS100, UK100, US30, SPX500, JP225, XAU, XAG, FX** — plus **shares**.
Minimum **5 years of H1**. Verified against the practice account on 13 Aug 2026:

| Check | Result |
|---|---|
| Index/metal instruments available | ✅ all eight, as CFDs |
| H1 history depth | ✅ all serve H1 from at least Jan 2019 — **7+ years**, comfortably past the 5 required |
| Individual shares | ❌ **not available on OANDA** — 123 instruments, 68 currency / 34 CFD / 21 metal, zero equities |

5 years of H1 ≈ **30,000 bars** per instrument, so 6 windows ≈ 10 months each. That is enough for
`minWindowsWithTrades: 4` to be a meaningful bar rather than a formality.

**Shares are a genuine gap, not an oversight.** OANDA cannot supply them, so equity backtesting
needs a second data source — Polygon, Finnhub, TwelveData and AlphaVantage keys are all already in
`.env.local`. That is a separate piece of work with its own cost model (commission and borrow, not
spread), its own session handling, and its own corporate-action problem (splits and dividends must
be adjusted or every long-run backtest is wrong). Deferred deliberately; the eight OANDA instruments
come first because they need no new integration.

### ⚠️ Costs re-measured — guessing has now been wrong four times

The grouped `US30|DE30|DE40|UK100|JP225` bucket in `defaultCosts` was a flat **guess of 2.4**, never
measured. Sampled live at 09:22 UTC on 13 Aug 2026:

| Instrument | Guessed | Measured | |
|---|---|---|---|
| JP225 | 2.4 | **12.0** | ⚠️ 5× understated |
| US30 | 2.4 | 3.5 | |
| XAG | 0.025 | 0.039 | |
| UK100 | 2.4 | 1.5 | the only over-statement |
| DE30 | 2.4 | 2.2 | |
| US2000 | — | 0.4 | newly added |

Every round-one measured value (NAS100 3.0, SPX500 0.50, XAU 0.73 vs 0.74, EUR_USD, GBP_USD,
USD_JPY, WTICO) **re-verified within 0.01**. Measured numbers hold; guessed ones do not.

JP225 at one fifth of its real spread would have turned a losing strategy into a winning one on an
instrument Peter actively trades. `defaultCosts` now carries per-instrument measured values and a
standing instruction not to add an instrument without measuring it.

**Caveat recorded in the code:** this is a single snapshot, taken in the London morning before the
US open and after the Tokyo cash close. Index CFD spreads are far more session-dependent than FX, so
JP225's 12.0 is an out-of-hours reading and is probably pessimistic during Tokyo hours. Sample
across the traded sessions before trusting any JP225 result.

### Built

- `src/lib/backtest/gate.ts` + tests — segmentation, seeded bootstrap, BH multiplicity control,
  `screen()` recording `testedCount`. 258 tests pass.
- Naming corrected in the code: this is **contiguous out-of-sample segmentation**, not classic
  walk-forward optimisation, because `PatternDef` parameters are fixed and nothing is fitted per
  window. The overfitting risk lives in *choosing among many patterns*, which is what the
  multiplicity control addresses.

- `src/lib/candles/pagination.ts` + tests — cursor logic, kept free of `server-only` and the db
  client so it is unit-testable. `src/lib/candles/backfill.ts` does the I/O.
- **History backfilled: 10 instruments × 7.6 years of H1** (~450,000 bars), plus D, H4 and M15.

### ⚠️ The resume bug, and why the trade-chart cache caused it

The obvious resume rule — "start from the newest stored candle" — is wrong here, and it failed in
the first real run. `service.ts` caches a few hundred candles around each *trade*, so an instrument
can hold a recent window and nothing else. Resuming from the newest candle then starts the walk
after that window and **silently skips every year before it**.

Observed live: a 121-bar smoke test left EUR_USD holding one week of July 2026. The universe
backfill then stored 633 bars for it and reported success, while every other instrument got 45,000.
The backtest that followed would have run on 0.1 years of history and looked entirely normal.

Fixed in `resolveResumeStart` (in `pagination.ts`, so it is testable): resume only when the *oldest*
stored candle already reaches back to `from`; otherwise restart from `from` and let the primary key
absorb the overlap. Redundant requests cannot lose history; a wrong cursor can. Re-run confirmed
EUR_USD at 47,399 bars / 7.6y. A hole in the *middle* of stored history is still not detected —
the coverage table flags those as "thin".

### ⚠️ The library's timeframes do not match "5 years of H1"

Peter asked for 5 years of H1. **No seed pattern is defined on H1** — the library is 5×M5, 5×M15,
5×H4, 5×D. H1 is still worth having (harvested TradingView strategies are commonly H1), but the
screen can only run a pattern on the granularity its trigger is defined on; running an M5 pattern
against H1 bars silently evaluates a different strategy, so the UI refuses to.

D, H4 and M15 are therefore backfilled too. **M5 is deliberately deferred**: 75 requests per
instrument and ~3.75M rows, for the one horizon that is already 0-for-10 out-of-sample (§8d).
Peter's call whether to spend it.

Coverage sanity note: UK100 lands at ~80% of the FX-derived expectation with no gaps, because the
LSE cash session is shorter. The "thin" threshold accounts for this rather than crying wolf.

### ⚠️ The 500 MB volume, and the bug it exposed

The M15 backfill filled the Postgres volume and **the database stopped accepting writes** — an
outage, caused by loading 1.35M candle rows without ever checking the volume's capacity. Peter
raised it to 500 MB; nothing was deleted, so the H1/H4/D history survived.

The failure then surfaced a second, subtler bug. `getHistory` used `ORDER BY time`, but the planner
reads an instrument/granularity range with a *bitmap* index scan, which does not preserve order, so
it appends a Sort node. Sorting ~180k rows spills to a temp file, and on a tight volume that fails:
`could not write to file "base/pgsql_tmp/…"`. A backtest that had all of its data still could not
read it. `ANALYZE` did not change the plan — the fix was to drop the SQL `ORDER BY` and sort in
Node, which costs nothing because every row is materialised into an array regardless.

**Storage budget at 500 MB.** Currently 224 MB. The practical ceiling is ~350 MB, because the volume
also holds WAL and temp files — bulk inserts spike both. Completing M15 for the remaining
instruments would be +140 MB and is *not* worth the risk; M5 (+590 MB) is off the table entirely.
Supabase Pro (8 GB, already paid for) is the right destination, but the migration is its own piece
of work: check whether the app is co-hosted on Railway first, and note that Supabase's
transaction-mode pooler needs `prepare: false` for `postgres.js`.

### Screening results — 120 candidates, nothing passed

| Run | Candidates | Passed |
|---|---|---|
| D + H4 × 10 instruments | 100 | **0** |
| M15 × 4 complete indices | 20 | **0** |

The D/H4 run produced tempting-looking leaders — `swing-bos-retest` on XAU at +34.6R over 263
trades, positive in 5 of 6 windows, p=0.007 — rejected at q=0.138 because p=0.007 is roughly what
the *best of 100* tries yields under the null. Screened alone it would have passed, which is the
entire argument for the multiplicity control.

The M15 run is blunter: **18 of 20 are outright negative**, several catastrophically
(`intraday-pdh-sweep-fade` on NAS100: 2,228 trades, −344R). The shape is unmistakable — high trade
counts multiplied by a small negative average R. That is cost drag, and it corroborates §8d's
finding that spread was ~76% of Peter's net loss. Frequent intraday patterns on index CFDs bleed
out on spread before edge gets a say.

Reading this honestly: the seed library is not a source of edges, which is exactly what §8b said it
was for. The screen is doing its job by saying so.

JP225 M15 is excluded from screens — its history stops at 2022-04-08 where the disk filled, so
screening it beside instruments holding 2019–2026 would compare regimes and call it a comparison.
Its ~76k orphan rows are harmless while nothing selects them.

### 📋 Pre-registered test: `swing-bos-retest` on XAU_USD H4

**Written before the data was fetched.** That is the entire point — a threshold chosen after seeing
the result is not a threshold.

*Why this one:* it led the 100-candidate D/H4 screen (+34.6R over 263 trades, 5/6 windows positive,
p=0.007) but was rejected at q=0.138, because p=0.007 is about what the best of 100 tries returns
under the null. Rejection there means "not distinguishable from luck **given how it was found**" —
not "does not work". The way to settle it is one hypothesis, stated in advance, on data that played
no part in selecting it.

| | |
|---|---|
| **Hypothesis** | Long `swing-bos-retest` on XAU_USD H4 has positive expectancy net of measured costs |
| **Data** | XAU_USD H4, **2006-03-19 → 2018-12-31** — never used in any screen |
| **N tested** | **1.** No multiplicity adjustment applies, so q = p. This is what pre-registration buys |
| **Costs** | Measured XAU spread 0.74 / slippage 0.35, unchanged |

**Pass criteria, all four required:**
1. ≥ 30 trades
2. Total R > 0
3. Consistency ≥ 0.66 across 6 windows
4. One-sided bootstrap p < 0.05

**Prediction from the 2019–2026 sample:** ~0.132 avg R, ~39% win rate, ~35 trades/year (so ~450
trades over 12.8 years). Regression toward zero is *expected* — this was a selected winner. A result
around 0.05–0.10 avg R would be consistent with a real but smaller edge; near 0.00 or negative means
the original number was selection.

**Caveat recorded in advance:** 2006–2018 spans the GFC, the 2011 peak, the 2013 crash and the
2015–2018 range. That is a strong robustness test, but a failure could be regime-specific rather
than proof of no edge. Also, OANDA's spread today is not 2008's — costs are held at today's
measured values, which is optimistic for the early years.

### 📋 Result: `swing-bos-retest` on XAU_USD H4 — **FAILED**

Run 13 Aug 2026 against XAU_USD H4, **2006-03-19 → 2018-12-31**, 20,582 bars that played no part
in selecting this pattern. Criteria were fixed in advance and are unaltered above.

| Metric | In-sample (2019–26) | Out-of-sample (2006–18) |
|---|---|---|
| Trades | 263 | **427** (predicted ~450) |
| Avg R | 0.132 | **0.0119** |
| Win rate | 39% | 33.0% |
| Total R | +34.6 | **+5.09** |
| Consistency | 5/6 | **3/6** |
| p | 0.007 | **0.343** |

| Criterion | Result |
|---|---|
| ≥ 30 trades | ✅ 427 |
| Total R > 0 | ✅ +5.09 |
| Consistency ≥ 0.66 | ❌ 0.500 |
| p < 0.05 | ❌ 0.343 |

**Verdict: failed.** Expectancy shrank by 91%, from 0.132R to 0.012R. Total return is +5.09R over
**twelve years and nine months** — economically indistinguishable from zero, and the "total R > 0"
pass is a technicality rather than a finding.

Per-window, the decay is plain: +5.7R and +6.2R in 2006–2010, then 0.4, −4.7, −0.5, −2.0. Whatever
was there belongs to the post-GFC gold bull and did not survive into the decade after it. This is
*not* the regime-specific failure the pre-registration allowed for — four of six windows are
non-positive and the two positive ones are the oldest.

Two things make the real result worse than the table. Costs were held at today's measured XAU
spread of 0.74, which is optimistic for 2006–2018 when spreads were wider. And the trade count came
in close to prediction (427 vs ~450), so this is not a thin-sample artefact — the pattern traded
plenty and simply did not make money.

**What this establishes.** The q=0.138 rejection in the 100-candidate screen was correct, and the
gate would have been right to block promotion even if Peter had overruled it. An in-sample p=0.007
that becomes p=0.343 out-of-sample is the precise signature of selection, observed end to end. The
screen's job is to stop numbers like +34.6R reaching live capital, and it did.

Running tally: **121 candidates measured, zero edges.**

### Harvest — first corpus, and what it is actually made of

MCP installed to `~/.local/share/tradingview-mcp`, registered via project-scoped `.mcp.json`.
Its own suite passes (60 tests) and the stdio handshake was verified before use. First harvest used
**93 of the 2,000 daily requests**: 120 scripts, **85 with Pine source**.

**Editors' picks is a shallow well.** Only 23 strategies exist in it, and most are not strategies:
educational examples ("Stop loss and Take Profit in $$ example"), frameworks ("Ultimate Strategy
Template"), tooling ("Trading Report Generator from CSV"), and a martingale published to
demonstrate that martingales blow up. Perhaps six are testable. Topic search is the better source,
but yields vary wildly — breakout 60, trend following 13, mean reversion 10, swing trading 4.

**What the corpus contains** (85 with source):

| Timeframe | n | | Asset class | n |
|---|---|---|---|---|
| H1 (60) | 17 | | crypto | 33 |
| M15 (15) | 17 | | equity/other | 26 |
| D | 15 | | India/IDX | 11 |
| M5 | 11 | | **FX** | **8** |
| H4 (240) | 7 | | futures | 7 |

Two things follow. Crypto dominates at 39%, and only 8 of 85 were published on FX — the chart an
author chose does not bind where a strategy can be tested, but it lowers the prior. And 28 of 85
sit on M5/M15, the horizons already 0-for-30 here.

**Translatability, measured rather than assumed:**

| Blocker | Scripts |
|---|---|
| `request.security` (multi-timeframe) | 18 |
| pyramiding / multi-entry | 15 |
| arrays / matrices | 11 |
| `ta.supertrend` | 2 |
| `ta.linreg` / correlation | 1 |
| **No blocker detected** | **44** |

`PatternDef` is single-timeframe and one-position-at-a-time, so `request.security` and pyramiding
are hard exclusions — per decision #69 these are *rejected, not approximated*. Note that "no
blocker" is a necessary condition, not a sufficient one: several of the 44 use no recognisable
`ta.*` primitives at all, meaning bespoke logic that still may not map.

**Best candidates on Peter's timeframes**, no blockers, recognisable primitives:

| Likes | TF | Name |
|---|---|---|
| 5,170 | H4 | Price and Volume Breakout Buy Strategy [TradeDots] |
| 519 | H4 | RSI Mean Reversion |
| 436 | D | ETF 3-Day Reversion Strategy |
| 1,049 | M15 | EMA Cross + RSI + ADX — Autotrade Strategy V2 |
| 657 | M15 | Bollinger Bands Mean Reversion using RSI |

The corpus is a reference cache (#67): SQLite at the install path, outside the repo, disposable.

### First translations — one rejected, one screened

**Both H4 candidates turned out to be stop-less signal-exit systems**, which the DSL could not
express at all. `PatternDef` had no way to close a position on a condition, so an entire family —
most trend-following, every stop-and-reverse system — was inexpressible. That is a gap in this
platform, not in those scripts.

**New: `exitRule?: Condition`.** Closes an open position when the condition holds on a bar's close.
Checked *after* the intrabar stop and target, since a close-based signal cannot pre-empt something
that already happened during the bar. `stop` stays required, because R is defined by risk at entry
and every figure here is denominated in R. Five engine tests cover it, including stop-wins-ties.

**REJECTED — Price and Volume Breakout [TradeDots]** (5,170 likes, the most popular H4 candidate).
Two independent grounds, either sufficient:
1. Its `volume > ta.highest(volume, 60)[1]` filter has no DSL equivalent, and dropping it would
   leave a plain breakout wearing the original's name — forbidden by #69.
2. More fundamentally, **OANDA's candle volume is tick count, not traded volume**. The strategy's
   central claim is that volume confirms a breakout; on FX and CFDs that claim cannot be tested at
   all. Extending the DSL would fix (1) and not (2), so it would not make this testable here.

**TRANSLATED — RSI Mean Reversion** (kparicharak92615, MPL-2.0), split long/short since PatternDef
carries one direction. Golden tests recompute RSI(3) independently and assert the trigger fires on
exactly the bars `ta.crossover` would, and that each side's exit is the other side's entry.

*Declared deviation:* a 10×ATR disaster stop, absent from the original, added only because R needs
risk at entry. **Fidelity verified rather than assumed: the stop took 0.9% of 38,188 exits.** Had
it been materially higher the translation would have been rejected as a different strategy.

### Result: 20 candidates on 20.6 years of H4 — **0 passed**

| | |
|---|---|
| Best | SPX500 long: 1,991 trades, **+19.6R**, avg 0.0099R, 5/6 windows, p=0.022, **q=0.448** |
| Worst | XAG short: **−64.7R**, 0/6 windows |
| Shape | 5 of 20 positive; every short on an index deeply negative |

Average R is ~0.01 or below across ~2,000 trades per candidate. That is the signature of a
**cost-dominated** strategy: RSI(3) is extremely fast, and at two thousand round trips the spread
is the whole story. Win rates of 55–60% on the longs do not rescue it — no target means small wins
and occasional large losses.

The long/short asymmetry is worth noting: longs beat shorts nearly everywhere on indices, which is
equity drift showing up as an apparent edge rather than anything the strategy found.

Running tally: **141 candidates measured, zero edges.**

### Low-frequency harvest — and the first thing to pass the gate

Corpus extended to **206 scripts / 143 sources** (351 of 2,000 daily requests). The search was
deliberately biased toward daily bars and few trades, on the evidence that everything failing so far
has been high-frequency and dying on spread.

Two more translations, plus one more DSL addition:

**New: `max` / `min` series operators.** `priorHigh(n)` deliberately excludes the current bar, while
Pine's `ta.highest(high, n)` includes it. The inclusive form is `max(priorHigh(n-1), high)`, so
without a pairwise max a **Donchian channel could not be expressed at all**. The absence of max/min
alongside add/sub/mul/div was arbitrary. `S.highestHigh(n)` / `S.lowestLow(n)` wrap the idiom, and
`describe.ts` renders them as "the highest high of the last n bars" rather than spelling out the
arithmetic. The exhaustive switch in `describe.ts` caught the omission at compile time.

- **Donchian Channel Strategy Idea** (QuantCT, D) — break the 10-bar extreme, exit through the
  midline. The off-by-one is the whole point: entry uses the *exclusive* prior extreme, the midline
  the *inclusive* current one, and on an entry bar (a new 10-bar high by definition) that difference
  moves the exit threshold. Approximating it would have been wrong on exactly the bars that matter.
- **8 Day Run** (Marcn5_, D, credits Linda Raschke) — after eight closes above the 5-SMA, buy the
  first close back to it. `barssince(...) >= 8` offset by one bar became eight explicit offset
  comparisons, because the DSL offsets series but not conditions. Verbose, but exact.

A golden-test guard earned its place here: the "actually produces signals" assertion caught the
8-Day-Run fidelity test passing **vacuously**, because the oscillating fixture flipped every five
bars and could never produce an eight-bar run. Both sides agreed on zero signals and the test was
meaningless until the fixture was replaced.

### ⚠️ `8 Day Run` on XAU passed — and should still not be traded

30 daily candidates screened over 20.6 years. Disaster stops took **0.1% of 4,613 exits**, so the
translations are faithful. One passed:

| | |
|---|---|
| `tv-8day-run` XAU_USD | 107 trades, **+3.88R**, avg 0.0363R, win 76%, 4/6 windows, **q=0.003** |

The first pass in **171 candidates**. It was then subjected to a control the gate cannot perform.

**The drift control.** This is a long-only strategy on an asset that went from ~$500 to ~$4,380
across the sample. The gate's bootstrap asks "is this different from zero"; it cannot ask "is this
different from simply being long gold". So: 5,000 runs of 107 random long entries on the same
instrument, matched for holding-period distribution, identical costs and R normalisation.

```
random long entries   mean 0.0090R   (95th pct 0.0325)
strategy              0.0363R        p = 0.032
```

It beats random longs, but **a quarter of its return is just gold's drift**, and p=0.032 is
suggestive rather than decisive.

**The decisive objection is economic, not statistical.** +3.88R over **twenty years and seven
months** is 0.19R per year — at 1% risk, roughly 0.19% annually, from about five trades a year.
That is indistinguishable from nothing once any unmodelled slippage, financing or execution
friction is included. It is statistically real and practically worthless.

**This exposes a genuine gap in the gate:** every criterion is statistical (trade count,
consistency, FDR). Nothing asks whether a survivor is *worth trading*. A minimum economic threshold
belongs in `GateCriteria` — but the number is Peter's business decision, not a statistical one, and
choosing it now, immediately after seeing which candidate it would exclude, would be exactly the
post-hoc threshold-fitting this whole apparatus exists to prevent. It should be set before the next
screen, not after this one.

Running tally: **171 candidates, one statistical pass, zero worth trading.**

### 🔴 BLOCKER as of 15 Aug 2026 — the database is unreachable

`DATABASE_URL` points at Supabase's **direct** host, `db.<ref>.supabase.co`, which is **IPv6-only**
without the IPv4 add-on. It connected on 13 Aug because this machine had IPv6 that day. It no longer
does, so DNS returns no A record and Node fails with `ENOTFOUND`.

The project is fine — the AAAA record still resolves to the same address. The connection string is
wrong for a world without guaranteed IPv6.

**Fix: switch to the session pooler**, which is IPv4 and was the original recommendation (#84 notes
the direct host was used instead). From Supabase → Connect → Session pooler:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Session mode (5432), not transaction mode (6543): this is a long-running Next server, and session
mode keeps prepared statements working. `src/lib/db/index.ts` already disables them automatically on
6543 if that is ever used. The same string goes in `.env.local` and in Railway's env.

### Still to build

1. **Economic-significance criterion** in `GateCriteria` — threshold set by Peter, *in advance*
   (#96, #97). Nothing currently stops the gate passing a strategy worth 0.19R a year.
2. **English → `PatternDef` compiler**, with `describe.ts` read-back for confirmation (#72).
3. Further translations from the ~42 remaining shortlist candidates.
4. **Promotion path** — incubating → demo book → Peter approves → live. Only worth building if
   something ever survives both the gate and an economic threshold.
5. M5 backfill (deferred, #79) and equities via a second data source (deferred, #75).

Scalp remains 0-for-10 out-of-sample (§8d), intraday is 0-for-20, and M5 stays unmeasured —
deliberately, since it is the most expensive horizon to store and the least supported by evidence.

---

## 9. Outstanding input

**Peter's actual patterns.** He flagged from the outset that he has "a bunch of potential patterns
I want to include and have you aware of." The *structure* is fully designed; the *content* still
needs to come from him in free text and will be captured verbatim into this document.

Not a blocker — the Pattern Library ships as a working structure in Phase 3 and can be populated at
any time, including during Phases 1–2. But the scanner (Phase 4) can't do anything useful until the
patterns exist.

**Also to pin down:** exact base risk % (0.5–1% chosen as a range) and the conviction multipliers
for A+/A/B/C. Both live in Settings and are trivially changed, so they don't block anything.

---

## 10. Verification

**Phase 1 is the real test** — if the data spine is right, everything downstream is a view.

1. **Token routing** — confirm live and practice tokens each reach the correct host, and that a
   practice account can never be queried with the live token.
2. **No-write guarantee** — audit that the OANDA client exposes read methods only. Grep for any
   POST/PUT to `/orders`, `/trades/*/close`, `/positions`. There should be none.
3. **Trade derivation** — reconcile derived trades against OANDA's own statement for a known week.
   P&L, financing and fill prices must match to the pip. Then re-run derivation from scratch and
   confirm the output is byte-identical (idempotency).
4. **R-multiples** — spot-check several trades by hand: planned risk from the stop order, actual
   result, resulting R. These underpin every analytics screen, so an error here poisons everything.
5. **Streaming** — confirm live P&L updates on the Live Desk, then kill the network and verify it
   reconnects cleanly without duplicating transactions.
6. **Book isolation** — verify each sub-account maps to the right book, that "All Live" aggregates
   exactly the four live books, and that **no demo data appears in any live view**.
7. **Secret hygiene** — inspect the client bundle and confirm no token is present.

Later phases: pattern-tagging accuracy against trades Peter tags himself, indicator values
cross-checked against a charting platform, and AI cost per run tracked in `ai_runs` from the first
call rather than discovered on a bill.

---

## Appendix — decision record

Every decision below was made by Peter across 14 AskUserQuestion rounds.

| # | Decision | Round |
|---|---|---|
| 1 | Markets: FX, commodities, indices, crypto — all OANDA CFDs | 1 |
| 2 | Data in: OANDA API + in-app entry forms | 1 |
| 3 | Hosted web app with database, phone-reachable | 1 |
| 4 | All four horizons: scalp, intraday, swing, position | 1 |
| 5 | OANDA is single source of truth — "futures" meant index/commodity CFDs | 2 |
| 6 | Fully live streaming, not a nightly journal sync | 2 |
| 7 | Per-trade charts auto-rendered from OANDA candles | 2 |
| 8 | `book` is a first-class schema dimension — four separate books | 2 |
| 9 | Token server-side only; read endpoints exclusively; no order placement | — |
| 10 | Persistent Node host (Railway), WebSocket push | 3 |
| 11 | Hard demo/live separation via account switcher | 3 |
| 12 | Europe/London display; UTC stored canonically | 3 |
| 13 | Single user, password protected | 3 |
| 14 | All 16 core-loop tabs confirmed | 4 |
| 15 | Pattern Library is load-bearing for Pattern Performance and grading | 4 |
| 16 | Full inventory: 24 screens across six sidebar groups | 5 |
| 17 | Grouped collapsible left sidebar + ⌘K palette | 5 |
| 18 | Landing screen: Today / Live Desk | 5 |
| 19 | Build order: data spine first | 5 |
| 20 | Demo account has a job: Idea Lab incubation | 5 |
| 21 | **Hard stops always → R-multiples and MAE/MFE fully automatic** | 6 |
| 22 | Alerts on all four channels; severity→channel routing | 6 |
| 23 | Pattern promotion: app recommends, Peter approves | 6 |
| 24 | Manual entry captures context, never numbers | 6 |
| 25 | AI: EOD drafting, playbook grading, pattern context, meta-analysis | 7 |
| 26 | AI runs on demand only | 7 |
| 27 | Calendar: Finnhub primary, Twelve Data fallback | 7 |
| 28 | Polymarket probabilities beside calendar events | 7 |
| 29 | AI also: indicator→suggestions, Q&A, pre-market brief, pre-trade check, voice journaling | 8 |
| 30 | Per-task model selection in Settings | 8 |
| 31 | Scanning: deterministic geometry + LLM context layer | 8 |
| 32 | Patterns = mechanical trigger + discretionary context | 8 |
| 33 | Indicators computed in-house, not from TradingView | 8 |
| 34 | Suggestion engine is a scanner over Peter's criteria — not advice | 8 |
| 35 | Charts: TradingView Lightweight Charts, themed | 9 |
| 36 | All four indicator families | 9 |
| 37 | Suggestions ranked, conviction-scored, with interrogable reasoning | 9 |
| 38 | Suggestions land in Best Opportunities, source-labelled | 9 |
| 39 | Patterns: flat list, multi-dimensional tags | 10 |
| 40 | Pattern record = trigger, context filters, target logic, live stats | 10 |
| 41 | Tagging: engine suggests, Peter confirms | 10 |
| 42 | Risk scaled by conviction — **plus a check that conviction predicts outcome** | 10 |
| 43 | Conviction scale: A+ / A / B / C | 11 |
| 44 | Base risk 0.5–1% (exact TBC) | 11 |
| 45 | Daily loss limit in R, calculated live | 11 |
| 46 | Separate OANDA sub-account per book | 11 |
| 47 | One shared pricing stream + one transaction stream per book | 11 |
| 48 | All four live sub-accounts already exist | 12 |
| 49 | Demo mirrors live → 8 accounts, 2 tokens | 12 |
| 50 | Live books roll up; demo never aggregates | 12 |
| 51 | Best Opps logs everything spotted + all AI candidates | 12 |
| 52 | Process grade separated from outcome | 13 |
| 53 | Four mistake categories, each costed in R | 13 |
| 54 | State: sleep/energy/focus, emotion pre-during-post, tilt markers | 13 |
| 55 | Hero metric: today's R vs limit (gauge) + cash P&L secondary | 13 |
| 56 | Orange = UI accent; green/red = money only | 14 |
| 57 | Reference aesthetic at ~2× density | 14 |
| 58 | Railway + managed Postgres | 14 |
| 59 | Cache candle windows around every trade, permanently | 14 |
| 60 | Peter has **no existing patterns** — library becomes a generated hypothesis backlog | build |
| 61 | 20 seed patterns, 5 per book, all four families, **fully mechanical** | build |
| 62 | Backtest → demo → live pipeline; everything seeds as `incubating` | build |
| 63 | Backtester reports out-of-sample alongside full-period (multiple-testing guard) | build |
| 64 | **Supersedes #59:** bulk historical candle store added for backtesting | build |
| 65 | Patterns stored as JSON DSL — one definition drives scanner *and* backtester | build |
| 66 | TradingView MCP server adopted for discovery — audited, MIT, local-only | 8e |
| 67 | Corpus is a gitignored reference cache — never Postgres, never a render dependency | 8e |
| 68 | **Supersedes #63:** walk-forward + tested-count required before bulk screening | 8e |
| 69 | Pine → `PatternDef` translation is human-supervised; inexpressible strategies rejected, not approximated | 8e |
| 70 | TradingView performance treated as discovery signal only, never as evidence | 8e |
| 71 | Rejected candidates retained with results rather than deleted | 8e |
| 72 | English compiles to `PatternDef`, with `describe.ts` read-back confirmation | 8e |
| 73 | Promotion to live remains manual — never automatic on a passing backtest | 8e |
| 74 | Universe: NAS100, UK100, US30, SPX500, JP225, XAU, XAG, FX — 5y H1 minimum (7y available) | 8e |
| 75 | **Shares deferred** — OANDA carries no equities; needs a second data source and a different cost model | 8e |
| 76 | **Supersedes the grouped index costs:** per-instrument measured spreads; JP225 was 5× understated | 8e |
| 77 | No instrument added to `defaultCosts` without measuring its spread first | 8e |
| 78 | Backfill resumes only when stored history reaches back to `from` — the trade-chart cache makes newest-candle resume unsafe | 8e |
| 79 | H1 + D + H4 + M15 backfilled; **M5 deferred** (75 req/instrument, 3.75M rows, 0-for-10 horizon) | 8e |
| 80 | A pattern is only screened on the granularity its trigger declares | 8e |
| 81 | `getHistory` sorts in Node, not SQL — the planner's bitmap scan forces a Sort that spills to temp files | 8e |
| 82 | Storage ceiling ~350 MB of the 500 MB volume; no further backfill until Supabase | 8e |
| 83 | JP225 M15 excluded from screens — truncated at 2022-04-08, different regime to the rest | 8e |
| 84 | **Supersedes #58:** database moved to Supabase (8 GB) — Railway's 500 MB volume could not absorb a 3 MB write | 8e |
| 85 | `DATABASE_PUBLIC_URL` removed entirely — a stale fallback silently connects to the wrong database | 8e |
| 86 | `swing-bos-retest` XAU **failed** pre-registered OOS: 0.132R → 0.012R, p 0.007 → 0.343. Selection, not edge | 8e |
| 87 | Deep history: D/H4/H1 from 2006 (20.6y), M15 from 2019 — **3.38M bars**, ~3× the windows for the gate | 8e |
| 88 | TradingView MCP registered via project `.mcp.json`, not the global config | 8e |
| 89 | Editors' picks is mostly tutorials and frameworks — topic search is the real source | 8e |
| 90 | 44 of 85 harvested scripts are translation candidates; MTF and pyramiding are hard exclusions | 8e |
| 91 | **`exitRule` added to the DSL** — condition-based exits, without which stop-less strategies were inexpressible | 8e |
| 92 | A disaster stop added for R must be *measured* (<1% of exits) or the translation is rejected | 8e |
| 93 | Volume-based strategies are untestable on OANDA — candle volume is tick count (rejects TradeDots breakout) | 8e |
| 94 | **`max`/`min` added to the DSL** — without them a Donchian channel is inexpressible | 8e |
| 95 | Long-only survivors must be controlled against random entries on the same asset, not just against zero | 8e |
| 96 | The gate has **no economic-significance criterion** — a statistical pass can still be worthless | 8e |
| 97 | That threshold must be set **before** the next screen, never after seeing what it would exclude | 8e |
