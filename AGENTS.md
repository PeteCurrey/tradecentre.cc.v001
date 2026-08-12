<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Trading Desk — project rules

Personal trading dashboard over OANDA. Full design rationale lives in
`docs/PLAN.md`; these are the invariants that must not be broken.

## 🔒 The OANDA client is read-only by construction

OANDA personal access tokens are **full trading credentials** — the v20 API has
no read-only scope. The only protection against placing a real order is that
`src/lib/oanda/client.ts` is incapable of writing.

- `request()` hardcodes `method: "GET"` and is private
- No `post`/`put`/`patch`/`delete`, no order or position-closing endpoints
- `src/lib/oanda/no-write.test.ts` asserts this at source level — **never weaken it**
- Both `env.ts` and `client.ts` import `server-only`, so a client-component
  import fails the build rather than leaking a token
- Nothing may ever be prefixed `NEXT_PUBLIC_`

If order placement is ever genuinely wanted it belongs in a separate,
explicitly-named module with its own confirmation flow — never in this client.

## 🎨 The colour rule

- **Orange** (`--color-accent`) = interface state: active, live, selected, armed
- **Green / red** = money: P&L only, and nothing else, ever

Because green/red only ever mean money, a red number is unambiguous at a glance.
Use `--color-warn` for risk and status, never green or red.

## 📊 Data integrity

- `transactions_raw` is the **source of truth**. Everything else is derived.
- `trades` are derived and never hand-edited. Re-deriving must always be safe
  and idempotent — fix bugs by replaying the ledger, not by data surgery.
- `trade_annotations` key on the **broker's** trade id, not a synthetic row id,
  so wiping and rebuilding `trades` can never orphan Peter's notes.
- **Demo never aggregates with live.** `all-live` covers the four live books
  only. This is the entire point of mirrored sub-accounts.
- Timestamps stored **UTC**, rendered **Europe/London**. Note OANDA rolls its
  trading day at 17:00 New York, so London-midnight days won't tie exactly to
  broker statements on positions carrying financing.
- OANDA's candle `volume` is **tick count, not traded volume** — FX has no
  centralised volume. Label it honestly wherever it surfaces.

## 🚫 Never fabricate data

Plausible-looking sample P&L in a trading dashboard is worse than an empty
screen, because you cannot tell at a glance whether what you're reading is real.
Use `NotConnected` / `ComingSoon` from `src/components/ui/Page.tsx` instead.

## Commands

```
npm run dev        # dev server
npm run build      # production build (runs tsc)
npm test           # node:test — includes the no-write guarantee
npm run typecheck
npm run db:generate / db:migrate / db:push / db:studio
```
