# Drawdown → Trading Desk single sign-on

How a drawdown.trading subscriber gets into the trading desk without a second
password. Hand this to whoever builds the Drawdown side.

Implemented in `src/lib/identity/drawdown.ts` and `src/app/api/auth/sso/route.ts`.
Tests: `src/lib/identity/drawdown.test.ts`.

---

## 1. The shape of it

```
Subscriber clicks "Open Trading Desk" on drawdown.trading
        │
        │  Drawdown mints a short-lived JWT for that user
        ▼
GET https://<desk-host>/api/auth/sso?token=<jwt>&next=/chat
        │
        │  Desk verifies the signature, finds or creates the user row,
        │  sets its own httpOnly session cookie, discards the token
        ▼
302 → /chat, signed in for 30 days
```

Drawdown is the only place a subscriber has a password. The desk stores no
credential for them, so this database is not worth stealing for account access.

**Issuing a token IS the statement that this person has paid.** The desk does
not check entitlement — that stays one system's job, not two disagreeing.

---

## 2. What Drawdown must mint

An **HS256** JWT signed with a secret shared by both systems.

| Claim  | Required | Value |
|--------|----------|-------|
| `iss`  | yes | `drawdown` |
| `aud`  | yes | `trading-desk` |
| `sub`  | yes | Drawdown's user id — stable and permanent |
| `iat`  | yes | Issued-at |
| `exp`  | yes | Issued-at + 60s is plenty |
| `name` | no  | Display name for chat. Defaults to `Member`, truncated at 60 chars |

### `sub` must never change for a given person

It becomes `users.external_id` (namespaced as `drawdown:<sub>`) and is the only
link between the two systems. If it changes, that person becomes a new user and
loses their chat history. Use the immutable primary key, **not** an email
address.

### Mint per click, not per session

The token travels in a URL, which is the least private place a secret can sit —
browser history, proxy logs, and the `Referer` header of the next request. So
it is spent immediately for an httpOnly cookie and is useless within minutes.

**The desk refuses any token whose `iat` is more than 5 minutes old, whatever
`exp` says.** A generous expiry at Drawdown's end cannot become a long-lived
credential at the desk's. Don't cache tokens; mint one at the moment of the
click.

---

## 3. Example (Node)

```js
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.DRAWDOWN_JWT_SECRET);

export async function deskLinkFor(user, next = "/") {
  const token = await new SignJWT({ name: user.displayName })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("drawdown")
    .setAudience("trading-desk")
    .setSubject(String(user.id))
    .setExpirationTime("60s")
    .sign(secret);

  return `https://<desk-host>/api/auth/sso?token=${encodeURIComponent(token)}` +
         `&next=${encodeURIComponent(next)}`;
}
```

Link it from a button. Don't put it in an email — by the time anyone clicks, it
has expired.

---

## 4. Configuration

One variable, the same value on both sides:

```
DRAWDOWN_JWT_SECRET=<32+ random bytes, base64>
```

Generate with `openssl rand -base64 32`. Set it in Railway on the desk service
and in Drawdown's environment. **Anyone holding it can mint a session as any
user**, so it belongs in environment variables on both sides and nowhere else —
not in a repo, not in a `.env` that gets committed.

Until it is set, `/api/auth/sso` returns **503** and Peter's password login is
unaffected. Nothing breaks by deploying this before Drawdown is ready.

Rotating it invalidates in-flight tokens only. Existing desk sessions survive,
because they are signed with `AUTH_SECRET`, which is separate.

---

## 5. The `next` parameter

Where to land after sign-in. Must be a **same-site path** — `/chat`, `/wire`,
`/`. Anything else (absolute URLs, protocol-relative `//host`) is ignored and
the subscriber lands on `/`. That is deliberate: without it, the parameter is an
open redirect that could bounce a freshly-authenticated member to a lookalike
site with their session already warm.

---

## 6. Responses

| Status | Meaning | Likely cause |
|--------|---------|--------------|
| `302` | Success | — |
| `401` | `Sign-in link is invalid or expired` | Wrong secret, wrong `aud`/`iss`, expired, `iat` over 5 min old, missing `sub` |
| `503` | SSO not configured | `DRAWDOWN_JWT_SECRET` not set on the desk |

The 401 is deliberately vague and identical for every failure — the difference
between "bad signature" and "expired" is only useful to someone probing. When
debugging, check the claims against §2 rather than expecting the error to say
which one was wrong.

It is deliberately **not** a redirect back to Drawdown either: an invalid token
must not become a bounce loop between two sites.

---

## 7. What happens on the desk side

First arrival creates a `users` row. Subsequent arrivals update the display name
and `last_seen_at`. It is an upsert, so two tabs finishing sign-in at once
cannot collide.

The session cookie is `desk_session` — httpOnly, `SameSite=Lax`, `Secure` in
production, 30 days.

**Chat terms are separate and are not part of SSO.** A new subscriber can read
chat immediately, and must accept the terms once before posting. Acceptance is
recorded with a timestamp and a version (`CHAT_TERMS_VERSION` in
`src/lib/identity/user.ts`); bump the version and everyone is asked again.

---

## 8. Not yet built

Worth stating so nobody assumes otherwise:

- **No sign-out propagation.** Cancelling a subscription at Drawdown does not
  end an existing desk session, which can last 30 days. If access must stop
  immediately, the desk needs either a webhook from Drawdown or a periodic
  entitlement re-check.
- **No roles.** Every signed-in user can read and post in every room. Moderation
  exists in the data model (`deleted_at`, `deleted_by`) but only the owner can
  currently act on it.
- **No per-user OANDA credentials.** Subscribers cannot yet connect their own
  broker account; the desk still uses one set of tokens from its environment.
