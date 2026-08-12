# Trading Desk

A personal trading dashboard over OANDA — a trade journal, live desk, pattern
library and backtester built around one account's actual ledger.

Single user. Private. **Reads the broker; never places an order.**

---

## 🔒 The safety invariant

OANDA personal access tokens are **full trading credentials** — the v20 API has
no read-only scope. The only real protection is that this client is incapable of
writing:

- `request()` in `src/lib/oanda/client.ts` hardcodes `method: "GET"` and is private
- no `post`/`put`/`patch`/`delete`, no order or position-closing endpoints
- `src/lib/oanda/no-write.test.ts` asserts all of this **at source level**, so a
  future edit that introduces a write path fails the build
- `env.ts` and `client.ts` both import `server-only`, so a client-component
  import fails the build rather than leaking a token
- no `NEXT_PUBLIC_*` variables exist anywhere, enforced by test

If order placement is ever wanted, it belongs in a separate, explicitly-named
module with its own confirmation flow — never in this client.

---

## Architecture

```
Railway (always-on Node)          Supabase Postgres
┌──────────────────────┐          ┌──────────────────┐
│ Next.js 16 (App Rtr) │◄────────►│ 18 tables        │
│ ├ SSE price feed     │          │ ledger + derived │
│ ├ indicator engine   │          └──────────────────┘
│ ├ pattern DSL + eval │
│ └ backtester         │◄──── OANDA v20 (REST + stream)
└──────────────────────┘◄──── FRED · EIA · Polymarket
```

**Always-on, not serverless.** The OANDA price stream is a long-lived HTTP
connection held open at process boot (`src/instrumentation.ts`) and fanned out to
browsers over Server-Sent Events. A serverless platform would cut it at the
function timeout, which is why this runs on Railway rather than Vercel.

---

## Core data rules

- **`transactions_raw` is the source of truth.** Everything else is derived.
- **`trades` are derived and never hand-edited.** Re-deriving is safe and
  idempotent — a bug is fixed by replaying the ledger, not by editing rows.
- **`trade_annotations` key on the broker's trade id**, not a synthetic row id,
  so wiping and rebuilding `trades` can never orphan journal notes.
- **`book` = instrument-class OANDA sub-account** (primary / fx / indices /
  commodities). **`horizon` = hold time** (scalp / intraday / swing / position),
  inferred per trade and overridable. Two separate dimensions.
- **Demo never aggregates with live.** That is the entire point of mirrored
  sub-accounts.
- Timestamps stored **UTC**, rendered **Europe/London**. Note OANDA rolls its
  trading day at 17:00 New York, so London-midnight days won't tie exactly to
  broker statements on positions carrying financing.
- OANDA candle `volume` is **tick count, not traded volume** — FX has no
  centralised volume. Labelled as such wherever it surfaces.

---

## The colour rule

- **Orange** = interface state: active, live, selected, armed
- **Green / red** = money: P&L only, and nothing else, ever

Because green and red only ever mean money, a red number is unambiguous at a
glance. Risk and status use amber, never green or red.

---

## Honesty rules

These are deliberate and load-bearing:

- **Never fabricate data.** Plausible-looking sample P&L in a trading dashboard
  is worse than an empty screen, because you cannot tell at a glance whether
  what you're reading is real. Use `NotConnected` / `ComingSoon`.
- **Seed patterns are hypotheses, not edges.** All 20 ship as `incubating` and
  the library says so on screen.
- **Backtests state their assumptions.** Entry is the next bar's open; when a bar
  touches both stop and target the stop wins; costs are charged both ways;
  out-of-sample is reported separately.
- **Clustered trades are flagged.** Positions closed in the same minute are one
  decision, not several — the Trade Log shows independent exits alongside trade
  count so statistics don't overstate their own confidence.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in
node scripts/hash-password.mjs "your password"   # prints AUTH_SECRET + hash
npm run db:migrate
npm run seed                   # books, accounts, instruments, 20 patterns
npm run sync                   # pull the ledger, derive trades
npm run dev
```

`DATABASE_URL` should use Supabase's **session pooler** (port 5432). The direct
host `db.<ref>.supabase.co` is IPv6-only on most projects and will fail from
IPv4 hosts such as Railway.

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build (runs tsc) |
| `npm test` | node:test — includes the no-write guarantee |
| `npm run typecheck` | tsc only |
| `npm run sync` | pull ledger + derive trades (`-- --rebuild` for a full replay) |
| `npm run seed` | reference data; safe to re-run |
| `npm run backtest` | run the seed patterns over real history |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle |

---

## Status

**Working:** auth · Live Desk · streaming prices · Trade Log · Trade Detail with
auto-rendered charts · journal (pattern, conviction, process grade, mistakes) ·
Pattern Library · Settings · sync from the UI · indicator engine · pattern DSL ·
backtester.

**Placeholder:** Pre-Market · Best Opportunities · End of Day · all analytics
screens · Risk · Research · the AI layer.

Design rationale and the full decision record live in [`docs/PLAN.md`](docs/PLAN.md).
