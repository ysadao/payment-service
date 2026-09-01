# Why payment APIs require idempotency

Portfolio/reference implementation demonstrating production patterns.

Networks fail. Clients retry. Load balancers replay. If `POST /payments` is not idempotent, a single customer click plus a timeout can capture the card **twice**.

## What goes wrong without a key

1. Client sends “charge $20”.
2. Server captures the card and crashes before the HTTP response.
3. Client retries with the same payload.
4. Server captures **another** $20.

Idempotency keys collapse those two HTTP calls into one business operation. The second request must return the **same** payment id and status, not a new intent.

## Rules used here

- `Idempotency-Key` is **required** on `POST /payments`.
- The server hashes the request body. Reusing a key with a **different** body is a `409`, not a silent second charge.
- The stored response is replayed byte-for-byte (status + JSON).
- Confirm, cancel, refund, and webhook handlers are also retry-safe: they key off payment id + event id and refuse illegal state transitions instead of double-posting the ledger.

## Scope

Keys are scoped to the authenticated operator. Two operators cannot collide. Keys are not a substitute for database unique constraints on `providerChargeId`; both layers exist in this service.
