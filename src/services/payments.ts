import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import { HttpError } from "../types.js";

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

export function serializePayment(p: Payment) {
  return {
    id: p.id,
    customerId: p.customerId,
    operatorId: p.operatorId,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    providerChargeId: p.providerChargeId,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function pushEvent(tx: Prisma.TransactionClient, paymentId: string, type: string, data: Record<string, unknown>) {
  await tx.paymentEvent.create({ data: { paymentId, type, data: data as Prisma.InputJsonValue } });
}

async function postLedger(
  tx: Prisma.TransactionClient,
  paymentId: string,
  refundId: string | null,
  operatorId: string,
  amountCents: number,
  currency: string,
  debit: string,
  credit: string,
) {
  await tx.ledgerEntry.createMany({
    data: [
      { paymentId, refundId, operatorId, account: debit, direction: "debit", amountCents, currency },
      { paymentId, refundId, operatorId, account: credit, direction: "credit", amountCents, currency },
    ],
  });
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: { actorId, action, resourceType, resourceId, metadata: metadata as Prisma.InputJsonValue },
  });
}

export async function createPayment(
  ctx: AppContext,
  operatorId: string,
  input: { customerId: string; amountCents: number; currency: string; description: string },
) {
  return ctx.prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, operatorId } });
    if (!customer) throw new HttpError(404, "Customer not found");
    const payment = await tx.payment.create({
      data: {
        operatorId,
        customerId: input.customerId,
        amountCents: input.amountCents,
        currency: input.currency.toLowerCase(),
        status: "requires_confirmation",
        description: input.description,
      },
    });
    await pushEvent(tx, payment.id, "payment.created", { amountCents: payment.amountCents });
    await writeAudit(tx, operatorId, "payment.created", "payment", payment.id, { amountCents: payment.amountCents });
    return payment;
  });
}

export async function confirmPayment(ctx: AppContext, operatorId: string, paymentId: string) {
  return ctx.prisma.$transaction(async (tx) => {
    const row = await tx.payment.findFirst({ where: { id: paymentId, operatorId } });
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status === "processing" || row.status === "succeeded") return row;
    if (row.status !== "requires_confirmation") {
      throw new HttpError(409, `Cannot confirm payment in status ${row.status}`);
    }
    const updated = await tx.payment.update({
      where: { id: row.id },
      data: {
        status: "processing",
        providerChargeId: `ch_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      },
    });
    await pushEvent(tx, updated.id, "payment.processing", { providerChargeId: updated.providerChargeId });
    await writeAudit(tx, operatorId, "payment.confirmed", "payment", updated.id, {
      providerChargeId: updated.providerChargeId,
    });
    return updated;
  });
}

export async function cancelPayment(ctx: AppContext, operatorId: string, paymentId: string) {
  return ctx.prisma.$transaction(async (tx) => {
    const row = await tx.payment.findFirst({ where: { id: paymentId, operatorId } });
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status === "canceled") return row;
    if (row.status !== "requires_confirmation") {
      throw new HttpError(409, `Cannot cancel payment in status ${row.status}`);
    }
    const updated = await tx.payment.update({
      where: { id: row.id },
      data: { status: "canceled" },
    });
    await pushEvent(tx, updated.id, "payment.canceled", {});
    await writeAudit(tx, operatorId, "payment.canceled", "payment", updated.id, {});
    return updated;
  });
}

export async function applyProviderEvent(
  ctx: AppContext,
  event: { eventId: string; type: "charge.succeeded" | "charge.failed"; providerChargeId: string; failureMessage?: string },
) {
  try {
    return await ctx.prisma.$transaction(async (tx) => {
      const existing = await tx.webhookEvent.findUnique({ where: { eventId: event.eventId } });
      if (existing) {
        const payment = await tx.payment.findUnique({ where: { providerChargeId: event.providerChargeId } });
        if (!payment) throw new HttpError(404, "Unknown provider charge");
        return payment;
      }
      await tx.webhookEvent.create({
        data: {
          eventId: event.eventId,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      const row = await tx.payment.findUnique({ where: { providerChargeId: event.providerChargeId } });
      if (!row) throw new HttpError(404, "Unknown provider charge");
      if (row.status === "succeeded" || row.status === "failed" || row.status === "canceled") return row;
      if (row.status !== "processing") throw new HttpError(409, `Unexpected status ${row.status} for provider event`);
      if (event.type === "charge.succeeded") {
        const updated = await tx.payment.update({
          where: { id: row.id },
          data: { status: "succeeded" },
        });
        await postLedger(tx, row.id, null, row.operatorId, row.amountCents, row.currency, "processor_clearing", "merchant_receivable");
        await pushEvent(tx, row.id, "payment.succeeded", {});
        await writeAudit(tx, null, event.type, "payment", row.id, { eventId: event.eventId });
        return updated;
      }
      const updated = await tx.payment.update({
        where: { id: row.id },
        data: { status: "failed" },
      });
      await pushEvent(tx, row.id, "payment.failed", { message: event.failureMessage ?? "declined" });
      await writeAudit(tx, null, event.type, "payment", row.id, { eventId: event.eventId });
      return updated;
    });
  } catch (err) {
    if (err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === "P2002") {
      const payment = await ctx.prisma.payment.findUnique({ where: { providerChargeId: event.providerChargeId } });
      if (!payment) throw new HttpError(404, "Unknown provider charge");
      return payment;
    }
    throw err;
  }
}

export async function refundPayment(ctx: AppContext, operatorId: string, paymentId: string, amountCents: number) {
  return ctx.prisma.$transaction(async (tx) => {
    const row = await tx.payment.findFirst({ where: { id: paymentId, operatorId } });
    if (!row) throw new HttpError(404, "Payment not found");
    if (row.status !== "succeeded") throw new HttpError(409, "Only succeeded payments can be refunded");
    const already = await tx.refund.aggregate({
      where: { paymentId, status: "succeeded" },
      _sum: { amountCents: true },
    });
    const captured = already._sum.amountCents ?? 0;
    if (amountCents + captured > row.amountCents) throw new HttpError(400, "Refund exceeds captured amount");
    const refund = await tx.refund.create({
      data: { operatorId, paymentId, amountCents, status: "succeeded" },
    });
    await postLedger(tx, paymentId, refund.id, operatorId, amountCents, row.currency, "merchant_receivable", "processor_clearing");
    await pushEvent(tx, paymentId, "refund.succeeded", { refundId: refund.id, amountCents });
    await writeAudit(tx, operatorId, "refund.created", "refund", refund.id, { paymentId, amountCents });
    return {
      id: refund.id,
      paymentId: refund.paymentId,
      amountCents: refund.amountCents,
      status: refund.status,
      createdAt: refund.createdAt.toISOString(),
    };
  });
}

export async function simulateProvider(
  ctx: AppContext,
  operatorId: string,
  paymentId: string,
  outcome: "succeeded" | "failed",
) {
  let payment = await ctx.prisma.payment.findFirst({ where: { id: paymentId, operatorId } });
  if (!payment) throw new HttpError(404, "Payment not found");
  if (payment.status === "requires_confirmation") {
    payment = await confirmPayment(ctx, operatorId, paymentId);
  }
  if (payment.status === "succeeded" || payment.status === "failed") {
    return serializePayment(payment);
  }
  if (payment.status !== "processing" || !payment.providerChargeId) {
    throw new HttpError(409, `Cannot simulate settlement in status ${payment.status}`);
  }
  const event = {
    eventId: `evt_sim_${randomUUID().replace(/-/g, "")}`,
    type: outcome === "succeeded" ? ("charge.succeeded" as const) : ("charge.failed" as const),
    providerChargeId: payment.providerChargeId,
    failureMessage: outcome === "failed" ? "simulated_decline" : undefined,
  };
  const raw = JSON.stringify(event);
  const { header } = signProviderPayload(raw);
  verifyProviderSignature(raw, header);
  const settled = await applyProviderEvent(ctx, event);
  return serializePayment(settled);
}
