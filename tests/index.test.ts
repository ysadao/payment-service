import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { createContext } from "../src/context.js";
import { signProviderPayload } from "../src/services/payments.js";

process.env.BCRYPT_ROUNDS ??= "4";

const tmp = await mkdtemp(path.join(os.tmpdir(), "pay-"));
const server = createServer(createApp(createContext(tmp)));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("no port");
const base = `http://127.0.0.1:${addr.port}`;

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await rm(tmp, { recursive: true, force: true });
});

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: payload,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, raw: payload };
}

test("health", async () => {
  const h = await json("GET", "/health");
  assert.equal(h.status, 200);
});

test("idempotent capture, webhook dedupe, refund ledger", async () => {
  const auth = await json("POST", "/auth/register", { email: "ops@pay.test", password: "password12" });
  assert.equal(auth.status, 201);
  const token = auth.data.accessToken;
  const hdr = { authorization: `Bearer ${token}` };

  const customer = await json("POST", "/customers", { email: "buyer@test.com", name: "Buyer" }, hdr);
  assert.equal(customer.status, 201);

  const missingKey = await json(
    "POST",
    "/payments",
    { customerId: customer.data.id, amountCents: 2000, currency: "usd" },
    hdr,
  );
  assert.equal(missingKey.status, 400);

  const body = { customerId: customer.data.id, amountCents: 2000, currency: "usd", description: "Invoice 1" };
  const first = await json("POST", "/payments", body, { ...hdr, "idempotency-key": "pay-1" });
  const replay = await json("POST", "/payments", body, { ...hdr, "idempotency-key": "pay-1" });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(first.data.id, replay.data.id);
  assert.equal(first.data.status, "requires_confirmation");

  const clash = await json(
    "POST",
    "/payments",
    { ...body, amountCents: 9999 },
    { ...hdr, "idempotency-key": "pay-1" },
  );
  assert.equal(clash.status, 409);

  const confirmed = await json("POST", `/payments/${first.data.id}/confirm`, {}, hdr);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.status, "processing");
  assert.ok(confirmed.data.providerChargeId);

  const event = {
    eventId: "evt_abc12345",
    type: "charge.succeeded" as const,
    providerChargeId: confirmed.data.providerChargeId,
  };
  const raw = JSON.stringify(event);
  const { header } = signProviderPayload(raw);
  const hook = await fetch(`${base}/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": header },
    body: raw,
  });
  assert.equal(hook.status, 200);
  const hookAgain = await fetch(`${base}/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": header },
    body: raw,
  });
  assert.equal(hookAgain.status, 200);

  const paid = await json("GET", `/payments/${first.data.id}`, undefined, hdr);
  assert.equal(paid.data.status, "succeeded");

  const events = await json("GET", `/payments/${first.data.id}/events`, undefined, hdr);
  assert.ok(events.data.events.some((e: { type: string }) => e.type === "payment.succeeded"));

  const refund = await json("POST", "/refunds", { paymentId: first.data.id, amountCents: 500 }, hdr);
  assert.equal(refund.status, 201);

  const ledger = await json("GET", "/ledger", undefined, hdr);
  const cents = ledger.data.ledger.reduce(
    (s: number, e: { direction: string; amountCents: number }) => s + (e.direction === "credit" ? e.amountCents : 0),
    0,
  );
  assert.equal(cents, 2500);

  const cancelable = await json("POST", "/payments", { ...body, description: "later" }, { ...hdr, "idempotency-key": "pay-2" });
  const canceled = await json("POST", `/payments/${cancelable.data.id}/cancel`, {}, hdr);
  assert.equal(canceled.data.status, "canceled");
});

test("bad webhook signature is rejected", async () => {
  const res = await fetch(`${base}/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ eventId: "evt_nope123", type: "charge.succeeded", providerChargeId: "ch_x" }),
  });
  assert.equal(res.status, 401);
});
