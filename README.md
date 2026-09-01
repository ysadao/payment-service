# Payment Service

Portfolio/reference implementation demonstrating production patterns.

A FinTech-style payments backend with customers, payment intents, refunds, an immutable ledger, HMAC-verified provider webhooks, and **required** idempotency on payment creation. Persistence is a typed JSON file store (Windows-friendly; no native SQLite).

## Features

- Customer records
- Payment intents: create → confirm → succeed / fail / cancel
- Refunds against succeeded charges
- `Idempotency-Key` **required** on `POST /payments`
- Simulated card processor + `POST /webhooks/provider` (HMAC SHA-256)
- Retry-safe webhooks (dedupe by `eventId`)
- Immutable transaction ledger
- Payment event timeline
- Audit log
- JWT-protected operator API (register/login)

## Stack

TypeScript, Express, Zod, jsonwebtoken, bcryptjs, Node crypto HMAC, JSON store.

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/why-idempotency.md](docs/why-idempotency.md).

State machine:

`requires_confirmation` → `processing` → `succeeded` | `failed` | `canceled`

Confirming an intent registers a provider charge id. The simulated provider then posts a signed webhook. Duplicate webhook deliveries are ignored after the first successful apply.

## API

Default port: **4103**.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/docs` | Endpoint catalog |
| POST | `/auth/register` | Operator account |
| POST | `/auth/login` | JWT |
| GET | `/customers` | Auth |
| POST | `/customers` | Auth |
| GET | `/customers/:id` | Auth |
| POST | `/payments` | Auth + **Idempotency-Key** |
| GET | `/payments` | Auth |
| GET | `/payments/:id` | Auth |
| GET | `/payments/:id/events` | Auth |
| POST | `/payments/:id/confirm` | Auth |
| POST | `/payments/:id/cancel` | Auth |
| POST | `/refunds` | Auth + Idempotency-Key recommended |
| GET | `/ledger` | Auth |
| GET | `/audit` | Auth |
| POST | `/webhooks/provider` | HMAC header `x-provider-signature` |

## Setup

```bash
npm install
copy .env.example .env
npm run dev
npm test
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4103` | Listen port |
| `JWT_ACCESS_SECRET` | demo secret | Operator JWT |
| `JWT_REFRESH_SECRET` | demo secret | Reserved |
| `PROVIDER_WEBHOOK_SECRET` | demo secret | HMAC key for provider callbacks |
| `DATA_DIR` | `./data` | JSON store |
| `BCRYPT_ROUNDS` | `10` | Password hash cost |

JWT and webhook secrets have safe local-demo defaults. Rotate them before any shared environment.

Compose includes optional Postgres and Redis; the running service still uses the JSON store.
