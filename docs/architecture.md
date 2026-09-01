# Architecture

Portfolio/reference implementation demonstrating production patterns for card-not-present payments.

## Components

- **Operator auth** — JWT for dashboard/API users. Not the cardholder.
- **Customers** — billable parties referenced by payments.
- **Payment intents** — amount, currency, customer, and state.
- **Provider adapter** — in-process simulator that mints `ch_…` charge ids.
- **Webhooks** — HMAC SHA-256 over the raw JSON body; timestamp + signature header.
- **Ledger** — append-only debit/credit entries; refunds post reversing lines.
- **Idempotency store** — maps `(scope, key)` to the original HTTP response.

## Webhook verification

`x-provider-signature` is `t=<unix>,v1=<hex hmac>`. HMAC is `HMAC_SHA256(secret, `${t}.${rawBody}`)`. Signatures older than five minutes are rejected. Processing is keyed by `eventId` so retries are no-ops.

## Ledger invariant

A succeeded payment posts:

- debit `processor_clearing`
- credit `merchant_receivable`

A refund posts the inverse. Entries are never updated in place.
