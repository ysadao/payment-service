import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import { HttpError, type LedgerEntry, type Payment, type PaymentEvent } from "../types.js";

export function signProviderPayload(rawBody: string, secret = config.providerWebhookSecret, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return { header: `t=${ts},v1=${v1}`, ts, v1 };
}

export function verifyProviderSignature(rawBody: string, header: string | undefined, maxAgeSec = 300) {
  if (!header) throw new HttpError(401, "Missing x-provider-signature");
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!ts || !v1) throw new HttpError(401, "Malformed provider signature");
  if (Math.abs(Date.now() / 1000 - ts) > maxAgeSec) throw new HttpError(401, "Stale provider signature");
  const expected = createHmac("sha256", config.providerWebhookSecret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Invalid provider signature");
}

function pushEvent(db: { events: PaymentEvent[] }, paymentId: string, type: string, data: Record<string, unknown>) {
  db.events.push({
    id: randomUUID(),
    paymentId,
    type,
    data,
    createdAt: new Date().toISOString(),
  });
}

function postLedger(
  db: { ledger: LedgerEntry[] },
  paymentId: string,
  refundId: string | null,
  amountCents: number,
  currency: string,
  debit: string,
  credit: string,
) {
  const now = new Date().toISOString();
  db.ledger.push({
    id: randomUUID(),
    paymentId,
    refundId,
    account: debit,
    direction: "debit",
    amountCents,
    currency,
    createdAt: now,
  });
  db.ledger.push({
    id: randomUUID(),
    paymentId,
    refundId,
    account: credit,
    direction: "credit",
    amountCents,
    currency,
    createdAt: now,
  });
}

export async function createPayment(
  ctx: AppContext,
  operatorId: string,
  input: { customerId: string; amountCents: number; currency: string; description: string },
) {
  let payment: Payment | undefined;
  await ctx.store.update((db) => {
    if (!db.customers.some((c) => c.id === input.customerId)) throw new HttpError(404, "Customer not found");
    payment = {
      id: randomUUID(),
      customerId: input.customerId,
      amountCents: input.amountCents,
      currency: input.currency.toLowerCase(),
      status: "requires_confirmation",
      providerChargeId: null,
      description: input.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.payments.push(payment);
    pushEvent(db, payment.id, "payment.created", { amountCents: payment.amountCents });
    db.audit.push({
      id: randomUUID(),
      actorId: operatorId,
      action: "payment.created",
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { amountCents: payment.amountCents },
      createdAt: new Date().toISOString(),
    });
  });
  return payment!;
}

export async function confirmPayment(ctx: AppContext, operatorId: string, paymentId: string) {
  let payment: Payment | undefined;
  await ctx.store.update((db) => {
    const row = db.payments.find((p) => p.id === paymentId);
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status === "processing" || row.status === "succeeded") {
      payment = row;
      return;
    }
    if (row.status !== "requires_confirmation") {
      throw new HttpError(409, `Cannot confirm payment in status ${row.status}`);
    }
    row.status = "processing";
    row.providerChargeId = `ch_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    row.updatedAt = new Date().toISOString();
    payment = row;
    pushEvent(db, row.id, "payment.processing", { providerChargeId: row.providerChargeId });
    db.audit.push({
      id: randomUUID(),
      actorId: operatorId,
      action: "payment.confirmed",
      resourceType: "payment",
      resourceId: row.id,
      metadata: { providerChargeId: row.providerChargeId },
      createdAt: new Date().toISOString(),
    });
  });
  return payment!;
}

export async function cancelPayment(ctx: AppContext, operatorId: string, paymentId: string) {
  let payment: Payment | undefined;
  await ctx.store.update((db) => {
    const row = db.payments.find((p) => p.id === paymentId);
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status === "canceled") {
      payment = row;
      return;
    }
    if (row.status !== "requires_confirmation") {
      throw new HttpError(409, `Cannot cancel payment in status ${row.status}`);
    }
    row.status = "canceled";
    row.updatedAt = new Date().toISOString();
    payment = row;
    pushEvent(db, row.id, "payment.canceled", {});
    db.audit.push({
      id: randomUUID(),
      actorId: operatorId,
      action: "payment.canceled",
      resourceType: "payment",
      resourceId: row.id,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  });
  return payment!;
}

export async function applyProviderEvent(
  ctx: AppContext,
  event: { eventId: string; type: "charge.succeeded" | "charge.failed"; providerChargeId: string; failureMessage?: string },
) {
  let payment: Payment | undefined;
  await ctx.store.update((db) => {
    if (db.providerEvents.some((e) => e.eventId === event.eventId)) {
      payment = db.payments.find((p) => p.providerChargeId === event.providerChargeId);
      return;
    }
    db.providerEvents.push({ eventId: event.eventId, type: event.type, processedAt: new Date().toISOString() });
    const row = db.payments.find((p) => p.providerChargeId === event.providerChargeId);
    if (!row) throw new HttpError(404, "Unknown provider charge");
    if (row.status === "succeeded" || row.status === "failed" || row.status === "canceled") {
      payment = row;
      return;
    }
    if (row.status !== "processing") throw new HttpError(409, `Unexpected status ${row.status} for provider event`);
    if (event.type === "charge.succeeded") {
      row.status = "succeeded";
      postLedger(db, row.id, null, row.amountCents, row.currency, "processor_clearing", "merchant_receivable");
      pushEvent(db, row.id, "payment.succeeded", {});
    } else {
      row.status = "failed";
      pushEvent(db, row.id, "payment.failed", { message: event.failureMessage ?? "declined" });
    }
    row.updatedAt = new Date().toISOString();
    payment = row;
    db.audit.push({
      id: randomUUID(),
      actorId: null,
      action: event.type,
      resourceType: "payment",
      resourceId: row.id,
      metadata: { eventId: event.eventId },
      createdAt: new Date().toISOString(),
    });
  });
  return payment!;
}

export async function refundPayment(ctx: AppContext, operatorId: string, paymentId: string, amountCents: number) {
  let refundId: string | undefined;
  await ctx.store.update((db) => {
    const row = db.payments.find((p) => p.id === paymentId);
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status !== "succeeded") throw new HttpError(409, "Only succeeded payments can be refunded");
    const already = db.refunds.filter((r) => r.paymentId === paymentId && r.status === "succeeded").reduce((s, r) => s + r.amountCents, 0);
    if (amountCents + already > row.amountCents) throw new HttpError(400, "Refund exceeds captured amount");
    const refund = {
      id: randomUUID(),
      paymentId,
      amountCents,
      status: "succeeded" as const,
      createdAt: new Date().toISOString(),
    };
    db.refunds.push(refund);
    refundId = refund.id;
    postLedger(db, paymentId, refund.id, amountCents, row.currency, "merchant_receivable", "processor_clearing");
    pushEvent(db, paymentId, "refund.succeeded", { refundId: refund.id, amountCents });
    db.audit.push({
      id: randomUUID(),
      actorId: operatorId,
      action: "refund.created",
      resourceType: "refund",
      resourceId: refund.id,
      metadata: { paymentId, amountCents },
      createdAt: new Date().toISOString(),
    });
  });
  return (await ctx.store.read()).refunds.find((r) => r.id === refundId)!;
}
