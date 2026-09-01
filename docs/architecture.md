# Architecture

Ledger is an operator console for card-not-present payments: Prisma/PostgreSQL, session auth, required capture idempotency, HMAC webhooks, and an immutable debit/credit ledger.

## Components

- **Operator auth** — register / login / refresh rotation / logout / logout-all / verify-email / forgot-reset. JWT access (15m) plus opaque refresh tokens stored as SHA-256 hashes. Sessions can be listed and revoked.
- **Tenancy** — `Customer` and `Payment` rows carry `operatorId`. Operator B cannot list or mutate A's records.
- **Payment intents** — amount, currency, customer, status enum.
- **Provider adapter** — in-process simulator that mints `ch_…` charge ids on confirm.
- **Webhooks** — HMAC SHA-256 over `t.rawBody`; `x-provider-signature: t=<unix>,v1=<hex>`; 5-minute max age; `timingSafeEqual`; unique `eventId`.
- **Demo simulator** — authenticated `POST /api/demo/simulate-provider` confirms if needed, signs a webhook with the real secret, and applies it internally so the UI can settle without curl.
- **Ledger** — append-only debit/credit entries; refunds post reversing lines. No updates in place.
- **Idempotency store** — Prisma unique on `(operatorId, method, path, key)`.

## Webhook verification

`x-provider-signature` is `t=<unix>,v1=<hex hmac>`. HMAC is `HMAC_SHA256(secret, \`${t}.${rawBody}\`)`. Signatures older than five minutes are rejected. Processing is keyed by `eventId` so retries are no-ops.

## Ledger invariant

A succeeded payment posts:

- debit `processor_clearing`
- credit `merchant_receivable`

A refund posts the inverse. Entries are never updated in place.

## SPA

Vite builds `web/dist`. Express serves it on port 3103 and falls back to `index.html` for client routes.
