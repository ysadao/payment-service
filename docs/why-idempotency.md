# Why payment APIs require idempotency

Networks fail. Clients retry. Load balancers replay. If `POST /api/payments` is not idempotent, a single operator click plus a timeout can capture the card **twice**.

## What goes wrong without a key

1. Client sends “charge $20”.
2. Server captures the intent and crashes before the HTTP response.
3. Client retries with the same payload.
4. Server opens **another** $20 intent.

Idempotency keys collapse those two HTTP calls into one business operation. The second request must return the **same** payment id and status, not a new intent.

## Rules used here

- `Idempotency-Key` is **required** on `POST /api/payments`.
- The server hashes the request body. Reusing a key with a **different** body is a `409`, not a silent second charge.
- The stored response is replayed (status + JSON) after the first write commits.
- Keys are scoped to `(operatorId, method, path, key)` so two operators cannot collide, and a refund key cannot alias a capture key.
- Confirm, cancel, refund, and webhook handlers are retry-safe: illegal transitions return `409`; webhooks dedupe on unique `eventId`.

## Operator console

The payments screen keeps the last key and offers **Retry with same idempotency key**. Submit twice: the table still shows one row. **New key** starts a distinct intent.

## Scope

Idempotency is not a substitute for `providerChargeId` uniqueness or ledger append-only inserts. Both layers exist in this service.
