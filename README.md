# Ledger — Operator Console

FinTech payments desk: Prisma + PostgreSQL, full operator auth, required idempotency on captures, HMAC provider webhooks, an immutable ledger, and a Vite React console served from Express.

Operational surface: `GET /api/ready` (Postgres ping), `GET /api/openapi.json`, `x-request-id` on every response, JSON request logs.

This is a **reference implementation** of senior payments API patterns. It is not a live processor and does not prove years of production on-call.

## Demo login

| | |
| --- | --- |
| Email | `demo@ledger.app` |
| Password | `LedgerDemo123!` |

The seed user is **email-verified**. Seed also creates two customers, three payments (succeeded / processing / requires_confirmation), a refund on the succeeded charge, ledger lines, and audit rows.

Set `DEMO_EXPOSE_TOKENS=true` for local UI flows so register / forgot-password responses include one-time tokens, and so `POST /api/demo/simulate-provider` is enabled. Default is **off** (production Docker image never enables it).

## Stack

- API: Express, TypeScript ESM, Zod, JWT access (15m) + opaque hashed refresh
- Data: Prisma + PostgreSQL (`pay-pg` on host port **55432**)
- UI: Vite + React operator console (navy / gold)
- Tests: Node test runner against the **real** Postgres on `127.0.0.1:55432`

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/why-idempotency.md](docs/why-idempotency.md).

State machine:

`requires_confirmation` → `processing` → `succeeded` | `failed`

Cancel is allowed only from `requires_confirmation`. Confirming mints a `ch_…` provider charge id. Settlement arrives as a signed webhook (or the demo simulator, which confirms if needed and posts a correctly signed webhook internally).

## API

Default port: **3103**. Express serves `web/dist` for the SPA.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness |
| POST | `/api/auth/register` | Operator + session |
| POST | `/api/auth/login` | Access + refresh |
| POST | `/api/auth/refresh` | Rotation; **reuse of a revoked refresh revokes all sessions** |
| POST | `/api/auth/logout` | Revoke current / given session |
| POST | `/api/auth/logout-all` | Revoke every refresh |
| POST | `/api/auth/forgot-password` | Always `ok`; demo token when enabled |
| POST | `/api/auth/reset-password` | Revokes all sessions |
| POST | `/api/auth/verify-email` | One-time token |
| POST | `/api/auth/request-verification` | Auth required |
| GET | `/api/me` | Current operator |
| GET | `/api/me/sessions` | List |
| DELETE | `/api/me/sessions/:id` | Revoke |
| GET | `/api/dashboard` | Status counts + recent ledger |
| GET/POST | `/api/customers` | Scoped to the operator |
| POST | `/api/payments` | Auth + **Idempotency-Key** required |
| GET | `/api/payments` | List |
| GET | `/api/payments/:id` | Get |
| GET | `/api/payments/:id/events` | Timeline |
| POST | `/api/payments/:id/confirm` | → processing |
| POST | `/api/payments/:id/cancel` | From requires_confirmation |
| POST | `/api/refunds` | Succeeded only; Idempotency-Key recommended |
| GET | `/api/ledger` | Append-only lines |
| GET | `/api/audit` | Operator actions |
| POST | `/api/webhooks/provider` | HMAC `x-provider-signature` |
| POST | `/api/demo/simulate-provider` | Opt-in via `DEMO_EXPOSE_TOKENS=true` only |

Webhook header: `t=<unix>,v1=<hex hmac>` where HMAC is `HMAC_SHA256(secret, `${t}.${rawBody}`)`, compared with `timingSafeEqual`, max age 5 minutes, deduped by `eventId`. Ledger posts assert Σ debit == Σ credit per payment after every write.

## Setup

Postgres must already be reachable at `postgresql://app:app@127.0.0.1:55432/payments` (container `pay-pg`).

```bash
npm install
npm install --prefix web
copy .env.example .env
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

In another terminal: `npm run dev:web` (Vite proxies `/api` to 3103). Production: `npm run build && npm start` — Express serves the SPA on 3103.

```bash
npm test
npm run build
```

Tests set `BCRYPT_ROUNDS=4` and talk to the real database on 55432.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3103` | Listen port |
| `DATABASE_URL` | `postgresql://app:app@127.0.0.1:55432/payments` | Prisma |
| `JWT_ACCESS_SECRET` | demo secret | Access JWT |
| `JWT_ACCESS_TTL` | `15m` | Access lifetime |
| `JWT_REFRESH_TTL` | `7d` | Refresh lifetime |
| `PROVIDER_WEBHOOK_SECRET` | demo secret | HMAC key |
| `BCRYPT_ROUNDS` | `10` | Password hash cost (`4` in tests) |
| `DEMO_EXPOSE_TOKENS` | `false` | When `true`: echo verify/reset tokens + enable simulate-provider |

## Docker

```bash
docker compose up --build
```

- Postgres: container `pay-pg`, host **55432**
- App + SPA: **3103** (compose seeds the demo operator; the production image CMD does **not** auto-seed)

Open http://127.0.0.1:3103 and sign in with the demo operator.

## For reviewers

If you are reading this as a code sample, start here:

1. [`docs/architecture.md`](./docs/architecture.md) — domain vs infra split  
2. [`docs/why-idempotency.md`](./docs/why-idempotency.md) — capture key design  
3. [`src/domain/`](./src/domain/) — payment state machine + ledger journal builders  
4. [`src/infra/provider-signature.ts`](./src/infra/provider-signature.ts) — HMAC adapter  
5. [`tests/domain.test.ts`](./tests/domain.test.ts) then [`tests/index.test.ts`](./tests/index.test.ts)

Decisions worth noticing: provider settlement is driven by a pure state machine; ledger posts assert Σ debit == Σ credit; refresh-token reuse revokes the whole session family; `simulate-provider` is opt-in only.
