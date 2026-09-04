import { randomUUID } from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import {
  assertEntryBalanced,
  assertTotalsBalanced,
  captureJournal,
  LedgerInvariantError,
  refundJournal,
  type JournalEntry,
} from "../domain/ledger-book.js";
import {
  assertRefundAmount,
  canRefund,
  transition,
  type PaymentStatus,
} from "../domain/payment-machine.js";
import { signProviderPayload, verifyProviderSignature } from "../infra/provider-signature.js";
import { HttpError } from "../types.js";

export { signProviderPayload, verifyProviderSignature };

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

async function postJournal(tx: Prisma.TransactionClient, entry: JournalEntry) {
  assertEntryBalanced(entry);
  await tx.ledgerEntry.createMany({
    data: entry.lines.map((line) => ({
      paymentId: entry.paymentId,
      refundId: entry.refundId,
      operatorId: entry.operatorId,
      account: line.account,
      direction: line.direction,
      amountCents: line.amountCents,
      currency: line.currency,
    })),
  });
  const rows = await tx.ledgerEntry.findMany({
    where: { paymentId: entry.paymentId },
    select: { direction: true, amountCents: true },
  });
  try {
    assertTotalsBalanced(entry.paymentId, rows);
  } catch (err) {
    if (err instanceof LedgerInvariantError) throw new HttpError(500, err.message);
    throw err;
  }
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

function applyTransition(status: PaymentStatus, command: Parameters<typeof transition>[1]) {
  const result = transition(status, command);
  if (!result.ok) throw new HttpError(result.status, result.message);
  return result;
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
    const result = applyTransition(row.status, "confirm");
    if (result.idempotent) return row;
    const updated = await tx.payment.update({
      where: { id: row.id },
      data: {
        status: result.next,
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
    const result = applyTransition(row.status, "cancel");
    if (result.idempotent) return row;
    const updated = await tx.payment.update({
      where: { id: row.id },
      data: { status: result.next },
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

      const command = event.type === "charge.succeeded" ? "provider_succeeded" : "provider_failed";
      const result = applyTransition(row.status, command);
      if (result.idempotent) return row;

      if (event.type === "charge.succeeded") {
        const updated = await tx.payment.update({
          where: { id: row.id },
          data: { status: result.next },
        });
        await postJournal(tx, captureJournal(row.id, row.operatorId, row.amountCents, row.currency));
        await pushEvent(tx, row.id, "payment.succeeded", {});
        await writeAudit(tx, null, event.type, "payment", row.id, { eventId: event.eventId });
        return updated;
      }
      const updated = await tx.payment.update({
        where: { id: row.id },
        data: { status: result.next },
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
    const refundGate = canRefund(row.status);
    if (!refundGate.ok) throw new HttpError(refundGate.status, refundGate.message);

    const already = await tx.refund.aggregate({
      where: { paymentId, status: "succeeded" },
      _sum: { amountCents: true },
    });
    const captured = already._sum.amountCents ?? 0;
    const amountGate = assertRefundAmount(row.amountCents, captured, amountCents);
    if (!amountGate.ok) throw new HttpError(amountGate.status, amountGate.message);

    const refund = await tx.refund.create({
      data: { operatorId, paymentId, amountCents, status: "succeeded" },
    });
    await postJournal(tx, refundJournal(paymentId, refund.id, operatorId, amountCents, row.currency));
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
  if (!config.allowDemoSimulator) {
    throw new HttpError(404, "Not found");
  }
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
