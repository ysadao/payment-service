# Architecture

Ledger separates **payment rules** (pure domain) from **HTTP/Postgres** and from **provider crypto**.

```
routes/ → services/payments.ts → domain/payment-machine.ts
                              → domain/ledger-book.ts
                              → infra/provider-signature.ts
                              → prisma
```

## Components

- **Operator auth** — register / login / refresh (reuse of a revoked refresh revokes the whole session family) / logout / logout-all / verify-email / forgot-reset. JWT access (15m) plus opaque refresh tokens stored as SHA-256 hashes.
- **Tenancy** — `Customer` and `Payment` rows carry `operatorId`. Operator B cannot list or mutate A's records.
- **Payment state machine** (`domain/payment-machine.ts`) — pure transitions for confirm / cancel / provider settle / refund gates. Services map denials to HTTP 4xx.
- **Ledger book** (`domain/ledger-book.ts`) — builds balanced debit/credit journals; asserts entry and payment-level totals before commit.
- **Provider signature adapter** (`infra/provider-signature.ts`) — Stripe-style `t=,v1=` HMAC with `timingSafeEqual` and max-age window.
- **Webhooks** — unique `eventId` dedupe (including P2002 race); settlement applies the state machine inside a transaction.
- **Demo simulator** — `POST /api/demo/simulate-provider` only when `DEMO_EXPOSE_TOKENS=true`.
- **Idempotency store** — Prisma unique on `(operatorId, method, path, key)` with in-progress and body-hash clash handling.

## State machine

`requires_confirmation` → `processing` → `succeeded` | `failed`

Cancel only from `requires_confirmation`. Confirm is idempotent once already `processing`/`succeeded`. Provider events on terminal statuses are no-ops.

## Ledger invariant

Capture posts:

- debit `processor_clearing`
- credit `merchant_receivable`

Refund posts the inverse. Entries are never updated in place. Runtime asserts Σ debit == Σ credit for the payment after every journal post.

## SPA

Vite React operator console; Express serves `web/dist` in production builds.
