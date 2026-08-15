# The Wire — live feed, and trading from it

A design for two things that turn the desk from a journal into a management
tool: a **real-time feed** of what is happening in the world, and the ability
to **act on an item** without leaving the dashboard.

Decisions taken with Peter, 14 Aug 2026, are recorded inline as `Decision:`.

---

## 1. What this is for

The dashboard currently answers "how am I doing". It cannot answer "what is
going on". That second question is why a second monitor exists with a news site
on it, and the whole point of this feature is to make that monitor unnecessary.

So the bar is not "we have a news API wired in". The bar is: **with this screen
up all day, you would not alt-tab.**

---

## 2. What the reference build actually offers

The attached `investmentcentre.ag` repo was reviewed for its news, financial and
economic-calendar work. The finding matters, because it changes what we reuse.

**Its screens are hardcoded.** `apps/terminal/src/app/(console)/world/page.tsx`
is a 206-line component whose policy rates, CPI prints, GDP figures, bond yields
and FX calls (`'LONG'`, `'SHORT'`) are string literals typed into the file. Its
`packages/adapters/src/sec_edgar.ts` `fetch()` returns a fixed object describing
a filing by "Acme AI Tech Corp" that does not exist.

Under this project's *never fabricate data* rule none of that can be lifted, and
it should not be — a screen of plausible-looking macro figures in a trading
dashboard is worse than no screen, because you cannot tell by looking whether
what you are reading is real.

**What is worth taking is the source list.** The reference build enumerated free
feeds we had not considered, and that enumeration is genuinely useful:

| Source | Key needed | What it gives |
|---|---|---|
| SEC EDGAR | none (User-Agent only) | 8-K, S-1, 10-K/Q, Form 4 insider buys, real-time |
| CFTC Commitments of Traders | none | Weekly speculative positioning |
| FCA short positions | none | UK disclosed shorts |
| US Treasury fiscal | none | Issuance, cash balance |
| USASpending | none | Federal contract awards |
| Kalshi | none | Event-contract implied odds, alongside our Polymarket |

These are a backlog of real adapters, not a screen to copy.

---

## 3. What we already have

Worth stating so we build the gap rather than a parallel system:

- `macro_events` table and `src/lib/macro/sources.ts` — FRED release dates, EIA
  petroleum/gas, Polymarket odds. Real, fetched, persisted.
- `/market-context` — renders the above, and honestly states the gap (no
  consensus figures, thin non-US coverage).
- `/calendar` — a **P&L** heatmap. Despite the name it is not an economic
  calendar, and the two must not be confused in the UI.
- `POLYGON_API_KEY` and `FINNHUB_API_KEY` are already in `env.ts`. Settings
  even describes Polygon as "news, backup prices" — but **no news code exists
  anywhere in `src/`.** The keys are wired and unused.

The gap is therefore: **the stream**. Dated calendar entries exist; a flowing
feed of what just happened does not.

---

## 4. The feed

### 4.1 Placement

> **Decision:** home panel *and* a full screen.

- **`/` (Today)** gains a **Wire** column — a compact, scrolling, live list
  beside your P&L and open risk. Headline, source, age, instrument chips.
  Enough to catch something; not enough to get lost in.
- **`/wire`** — the full screen. Filters, source toggles, search, full item
  bodies, and the action buttons.

The Today panel is a window onto the same store, not a second implementation.

### 4.2 Sources

> **Decision:** all four categories.

| Category | Provider | Notes |
|---|---|---|
| Market news | Polygon `/v2/reference/news`, Finnhub `/news` | The bulk of the flow. Both keys already present. |
| Fed / central bank | federalreserve.gov RSS (press releases, FOMC, speeches) | Free, no key. BoE/ECB are a later addition. |
| Economic releases | existing FRED + EIA `macro_events` | Not re-fetched — projected *into* the stream as "due in 20m" and "released". |
| SEC filings | EDGAR real-time index | Free; requires a descriptive User-Agent header or it 403s. |

Every fetch fails soft and independently, following the pattern already set in
`macro/sources.ts`. One dead provider degrades one source, never the screen.

### 4.3 Storage

A new `feed_items` table. The stream must survive a reload, dedupe across
providers that carry the same wire story, and let "since you last looked" mean
something.

```
feed_items
  id            text primary key    -- source-prefixed, e.g. polygon:abc123
  source        text                -- polygon | finnhub | fed | sec | macro
  category      text                -- news | central_bank | economic | filing
  published_at  timestamptz
  headline      text
  summary       text
  url           text
  tickers       text[]              -- as given by the provider
  instruments   text[]              -- resolved to OUR instrument codes
  importance    smallint            -- see 4.5
  fetched_at    timestamptz
```

Indexed on `published_at desc`. Retention: 30 days, pruned on ingest.

### 4.4 Liveness

Polling on the server, pushed to the browser. There is already a broadcast
mechanism in `src/lib/desk/broadcast.ts` and a `src/lib/stream/` module for the
live P&L — the feed reuses it rather than inventing a second transport.

Poll cadences, chosen against each provider's actual update rate and rate limit:
news 60s, SEC 120s, Fed 300s, macro projection 60s.

### 4.5 Ordering and relevance

> **Decision:** chronological, with instrument tagging. No hidden ranking.

Newest first, always. What varies is **filtering**, never order:

- Every item is tagged with the instruments it touches, resolved from provider
  tickers and a keyword map (`gold`/`XAU`, `crude`/`WTI`, `ECB`/`EUR` …).
- A filter bar narrows to: everything · my open positions · my watchlist ·
  a chosen source.
- `importance` drives **emphasis** (weight, a rule, an accent) — not position.
  A high-importance item is more visible; it does not jump the queue.

The reason to refuse ranking: a feed that reorders itself is a feed you cannot
trust to have shown you something. Chronological means absence is meaningful.

The colour rule holds throughout — accent orange for live/new/selected state,
`--color-warn` for importance. **No green or red anywhere in the feed**, because
those mean money and nothing else.

---

## 5. Acting on an item

> **Decision:** three distinct buttons per instrument chip, so the action is
> never ambiguous.

Each resolved instrument on a feed item carries:

1. **Chart** — candles and your saved `watchlist_levels` for that instrument.
2. **Watch** — adds to the watchlist with the feed item stored as the reason,
   so next week you still know why it is there.
3. **Trade** — opens a ticket. See below.

(Trade history on the instrument was not selected, and is left out.)

---

## 6. Manual trading

> **Decision:** build now. Alpaca for shares; OANDA for FX, indices and
> commodities. Live accounts from the start.

### 6.1 Why both brokers

Alpaca trades US shares, ETFs and crypto — it has **no FX, no indices, no
commodities**. A gold or ECB story is untradeable through it. OANDA covers those
and not single stocks. The two together cover the original ask; either alone
does not.

### 6.2 OANDA — reuse, do not rebuild

The write path **already exists** and is well-guarded. `src/lib/oanda/execution.ts`
exposes `submitMarketOrder(approval: GuardApproval, …, send: boolean)`, where
`GuardApproval` is a branded type only `approveOrder()` in
`src/lib/execution/guards.ts` can mint. Bypassing the guards is a type error.

**`src/lib/oanda/client.ts` is not touched, and `no-write.test.ts` is not
weakened.** Manual trading changes nothing about the read-only guarantee.

Two of the nine guards are engine-specific and need manual variants:

- **`armed`** — denies unless the autonomous engine is armed. A manual trade
  must not require arming the robot. Replaced by a manual-trading enable flag
  that is independently switched.
- **`patternEnabled`** — denies any order where `patternId === null`, which is
  every manual trade. Replaced by a required **reason**: the feed item id, so
  every manual order is permanently traceable to what prompted it.

The other seven apply **unchanged**: live-capital unlock, daily loss limit,
open-position cap, instrument allowlist, stop-required (with the wrong-side
check), the sizing risk ceiling, and the rate limit.

That last set is the reason live-from-the-start is defensible. A mis-click
cannot exceed the daily loss limit, cannot place a stopless order, and cannot
exceed the risk ceiling — those are not settings the ticket consults, they are
refusals it cannot route around.

### 6.3 Alpaca — new, and guarded to the same standard

A new `src/lib/alpaca/` module, structured to mirror OANDA's split:

- `client.ts` — read-only by construction, `method: "GET"` hardcoded, private
  `request()`, `server-only`. Same discipline, same reasoning.
- `execution.ts` — the only module permitted to write, requiring its own
  branded approval.
- Guards shared with OANDA where the logic is identical (loss limit, sizing,
  rate limit, stop-required); Alpaca-specific where it must be (shares are
  whole units, no fractional-unit sizing).

**`no-write.test.ts` must be extended.** Its "execution is the ONLY module that
writes" assertion currently matches on `oanda|fxtrade|fxpractice` and would not
notice an unguarded Alpaca write anywhere in `src/`. Broadening it is part of
this work, not a follow-up.

### 6.4 The ticket

Opened from a feed item, pre-filled and then explicitly confirmed:

- Instrument, side, entry (market).
- **Stop is mandatory** — the ticket cannot be submitted without one, because
  the guard will refuse it anyway. Better to refuse in the UI, with a reason.
- Size computed from stop distance and your base risk fraction, shown as both
  units and "this risks £X / 1.0R".
- The originating headline, shown on the ticket and stored with the order.
- A **typed confirmation** — not a single click — and the guard verdict rendered
  before submission, so you see what passed before you commit.
- `send` is passed explicitly per call and never defaults true.

Every manual order lands in the existing `order_log` alongside engine orders,
distinguished by origin, so the audit trail is one trail.

---

## 7. Build order

1. `feed_items` table, ingest for the four sources, instrument resolution.
2. `/wire` screen, filters, and the Today panel.
3. Chart and Watch buttons.
4. Manual guard chain + OANDA ticket.
5. Alpaca client, execution, extended no-write test, shares ticket.

Steps 1–3 are self-contained and change nothing about execution. Step 4 reuses a
guarded path that already exists. Step 5 is the largest piece of genuinely new
risk surface and is deliberately last.
