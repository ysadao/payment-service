import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { createContext } from "../src/context.js";
import { prisma } from "../src/db.js";
import { signProviderPayload } from "../src/services/payments.js";

const server = createServer(createApp(createContext()));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("no port");
const base = `http://127.0.0.1:${addr.port}`;

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await prisma.$disconnect();
});

async function json(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: payload,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function auth(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function registerOp(prefix = "op") {
  const email = `${prefix}-${randomUUID()}@pay.test`;
  const res = await json("POST", "/api/auth/register", { email, password: "password12" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return { email, ...res.data };
}

test("health", async () => {
  const h = await json("GET", "/health");
  assert.equal(h.status, 200);
  const api = await json("GET", "/api/health");
  assert.equal(api.status, 200);
});

test("auth verify, reset, refresh rotation, logout-all", async () => {
  const user = await registerOp("auth");
  assert.ok(user.accessToken);
  assert.ok(user.refreshToken);
  assert.ok(user.demoToken);
  assert.equal(user.user.emailVerified, false);

  const verify = await json("POST", "/api/auth/verify-email", { token: user.demoToken });
  assert.equal(verify.status, 200);
  const me = await json("GET", "/api/me", undefined, auth(user.accessToken));
  assert.equal(me.status, 200);
  assert.equal(me.data.user.emailVerified, true);

  const rotated = await json("POST", "/api/auth/refresh", { refreshToken: user.refreshToken });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.data.accessToken);
  const reused = await json("POST", "/api/auth/refresh", { refreshToken: user.refreshToken });
  assert.equal(reused.status, 401);

  const forgot = await json("POST", "/api/auth/forgot-password", { email: user.email });
  assert.equal(forgot.status, 200);
  assert.ok(forgot.data.demoToken);
  const reset = await json("POST", "/api/auth/reset-password", {
    token: forgot.data.demoToken,
    password: "newpass123",
  });
  assert.equal(reset.status, 200);
  const oldLogin = await json("POST", "/api/auth/login", { email: user.email, password: "password12" });
  assert.equal(oldLogin.status, 401);
  const newLogin = await json("POST", "/api/auth/login", { email: user.email, password: "newpass123" });
  assert.equal(newLogin.status, 200);

  const second = await json("POST", "/api/auth/login", { email: user.email, password: "newpass123" });
  assert.equal(second.status, 200);
  const logoutAll = await json("POST", "/api/auth/logout-all", {}, auth(newLogin.data.accessToken));
  assert.equal(logoutAll.status, 200);
  const afterAllA = await json("POST", "/api/auth/refresh", { refreshToken: newLogin.data.refreshToken });
  const afterAllB = await json("POST", "/api/auth/refresh", { refreshToken: second.data.refreshToken });
  assert.equal(afterAllA.status, 401);
  assert.equal(afterAllB.status, 401);

  const sessionsLogin = await json("POST", "/api/auth/login", { email: user.email, password: "newpass123" });
  const listed = await json("GET", "/api/me/sessions", undefined, auth(sessionsLogin.data.accessToken));
  assert.ok(listed.data.sessions.length >= 1);
  const active = listed.data.sessions.find((s: { revokedAt: string | null }) => !s.revokedAt);
  const revoked = await json("DELETE", `/api/me/sessions/${active.id}`, undefined, auth(sessionsLogin.data.accessToken));
  assert.equal(revoked.status, 204);
});

test("idempotent capture, cannot confirm canceled, refund only on succeeded, webhook dedupe", async () => {
  const op = await registerOp("pay");
  const hdr = auth(op.accessToken);

  const customer = await json("POST", "/api/customers", { email: "buyer@test.com", name: "Buyer" }, hdr);
  assert.equal(customer.status, 201);

  const missingKey = await json(
    "POST",
    "/api/payments",
    { customerId: customer.data.id, amountCents: 2000, currency: "usd" },
    hdr,
  );
  assert.equal(missingKey.status, 400);

  const body = { customerId: customer.data.id, amountCents: 2000, currency: "usd", description: "Invoice 1" };
  const first = await json("POST", "/api/payments", body, { ...hdr, "idempotency-key": "pay-1" });
  const replay = await json("POST", "/api/payments", body, { ...hdr, "idempotency-key": "pay-1" });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(first.data.id, replay.data.id);
  assert.equal(first.data.status, "requires_confirmation");

  const clash = await json(
    "POST",
    "/api/payments",
    { ...body, amountCents: 9999 },
    { ...hdr, "idempotency-key": "pay-1" },
  );
  assert.equal(clash.status, 409);

  const earlyRefund = await json("POST", "/api/refunds", { paymentId: first.data.id, amountCents: 500 }, hdr);
  assert.equal(earlyRefund.status, 409);

  const confirmed = await json("POST", `/api/payments/${first.data.id}/confirm`, {}, hdr);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.status, "processing");
  assert.ok(confirmed.data.providerChargeId);

  const processingRefund = await json("POST", "/api/refunds", { paymentId: first.data.id, amountCents: 500 }, hdr);
  assert.equal(processingRefund.status, 409);

  const event = {
    eventId: `evt_${randomUUID().replace(/-/g, "")}`,
    type: "charge.succeeded" as const,
    providerChargeId: confirmed.data.providerChargeId,
  };
  const raw = JSON.stringify(event);
  const { header } = signProviderPayload(raw);
  const hook = await fetch(`${base}/api/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": header },
    body: raw,
  });
  assert.equal(hook.status, 200);
  const hookAgain = await fetch(`${base}/api/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": header },
    body: raw,
  });
  assert.equal(hookAgain.status, 200);

  const paid = await json("GET", `/api/payments/${first.data.id}`, undefined, hdr);
  assert.equal(paid.data.status, "succeeded");

  const events = await json("GET", `/api/payments/${first.data.id}/events`, undefined, hdr);
  assert.ok(events.data.events.some((e: { type: string }) => e.type === "payment.succeeded"));

  const refund = await json("POST", "/api/refunds", { paymentId: first.data.id, amountCents: 500 }, hdr);
  assert.equal(refund.status, 201);

  const ledger = await json("GET", "/api/ledger", undefined, hdr);
  const cents = ledger.data.ledger.reduce(
    (s: number, e: { direction: string; amountCents: number }) => s + (e.direction === "credit" ? e.amountCents : 0),
    0,
  );
  assert.equal(cents, 2500);

  const cancelable = await json(
    "POST",
    "/api/payments",
    { ...body, description: "later" },
    { ...hdr, "idempotency-key": "pay-2" },
  );
  const canceled = await json("POST", `/api/payments/${cancelable.data.id}/cancel`, {}, hdr);
  assert.equal(canceled.data.status, "canceled");
  const confirmCanceled = await json("POST", `/api/payments/${cancelable.data.id}/confirm`, {}, hdr);
  assert.equal(confirmCanceled.status, 409);

  const simulated = await json(
    "POST",
    "/api/demo/simulate-provider",
    { paymentId: first.data.id, outcome: "succeeded" },
    hdr,
  );
  assert.equal(simulated.status, 200);
  assert.equal(simulated.data.status, "succeeded");
});

test("bad webhook signature is rejected", async () => {
  const res = await fetch(`${base}/api/webhooks/provider`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ eventId: "evt_nope123", type: "charge.succeeded", providerChargeId: "ch_x" }),
  });
  assert.equal(res.status, 401);
});

test("operator isolation: B cannot see A's customers or payments", async () => {
  const a = await registerOp("iso-a");
  const b = await registerOp("iso-b");
  const customer = await json(
    "POST",
    "/api/customers",
    { email: "secret@a.test", name: "Secret Co" },
    auth(a.accessToken),
  );
  assert.equal(customer.status, 201);
  const payment = await json(
    "POST",
    "/api/payments",
    { customerId: customer.data.id, amountCents: 3300, currency: "usd", description: "private" },
    { ...auth(a.accessToken), "idempotency-key": `iso-${randomUUID()}` },
  );
  assert.equal(payment.status, 201);

  const bCustomers = await json("GET", "/api/customers", undefined, auth(b.accessToken));
  assert.equal(bCustomers.status, 200);
  assert.equal(bCustomers.data.customers.length, 0);

  const bOne = await json("GET", `/api/customers/${customer.data.id}`, undefined, auth(b.accessToken));
  assert.equal(bOne.status, 404);

  const bPayments = await json("GET", "/api/payments", undefined, auth(b.accessToken));
  assert.equal(bPayments.data.payments.length, 0);

  const bPay = await json("GET", `/api/payments/${payment.data.id}`, undefined, auth(b.accessToken));
  assert.equal(bPay.status, 404);

  const bConfirm = await json("POST", `/api/payments/${payment.data.id}/confirm`, {}, auth(b.accessToken));
  assert.equal(bConfirm.status, 404);
});

test("readiness pings postgres, openapi and request ids", async () => {
  const ready = await json("GET", "/api/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.data.status, "ready");
  const spec = await json("GET", "/api/openapi.json");
  assert.equal(spec.data.openapi, "3.0.3");
  const res = await fetch(`${base}/api/health`, { headers: { "x-request-id": "ledger-review-1" } });
  assert.equal(res.headers.get("x-request-id"), "ledger-review-1");
});
