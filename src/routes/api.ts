import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { asyncHandler, type AuthedRequest, HttpErrorParser, requireOperator } from "../middleware/http.js";
import { optionalIdempotency, requireIdempotency } from "../middleware/idempotency.js";
import {
  forgotPassword,
  listSessions,
  login,
  loginSchema,
  logout,
  logoutAll,
  refresh,
  register,
  registerSchema,
  requestVerification,
  resetPassword,
  revokeSession,
  verifyEmail,
} from "../services/auth.js";
import {
  applyProviderEvent,
  cancelPayment,
  confirmPayment,
  createPayment,
  refundPayment,
  serializePayment,
  simulateProvider,
  verifyProviderSignature,
} from "../services/payments.js";
import { HttpError, publicUser } from "../types.js";

const customerSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  name: z.string().min(1).max(120),
});
const paymentSchema = z.object({
  customerId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default("usd"),
  description: z.string().max(200).default(""),
});
const refundSchema = z.object({
  paymentId: z.string().uuid(),
  amountCents: z.number().int().positive(),
});
const webhookSchema = z.object({
  eventId: z.string().min(8),
  type: z.enum(["charge.succeeded", "charge.failed"]),
  providerChargeId: z.string().min(4),
  failureMessage: z.string().optional(),
});
const simulateSchema = z.object({
  paymentId: z.string().uuid(),
  outcome: z.enum(["succeeded", "failed"]),
});

function serializeCustomer(c: { id: string; email: string; name: string; createdAt: Date; operatorId: string }) {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    operatorId: c.operatorId,
    createdAt: c.createdAt.toISOString(),
  };
}

export function buildRouter(ctx: AppContext) {
  const router = Router();

  router.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(registerSchema, req.body);
      const result = await register(ctx, body, req.get("user-agent") ?? null);
      res.status(201).json(result);
    }),
  );

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(loginSchema, req.body);
      const result = await login(ctx, body, req.get("user-agent") ?? null);
      res.json(result);
    }),
  );

  router.post(
    "/auth/refresh",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(z.object({ refreshToken: z.string().min(20) }), req.body);
      const result = await refresh(ctx, body.refreshToken, req.get("user-agent") ?? null);
      res.json(result);
    }),
  );

  router.post(
    "/auth/forgot-password",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(
        z.object({ email: z.string().email().transform((v) => v.toLowerCase()) }),
        req.body,
      );
      res.json(await forgotPassword(ctx, body.email));
    }),
  );

  router.post(
    "/auth/reset-password",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(z.object({ token: z.string().min(10), password: z.string().min(8) }), req.body);
      await resetPassword(ctx, body.token, body.password);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/auth/verify-email",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(z.object({ token: z.string().min(10) }), req.body);
      await verifyEmail(ctx, body.token);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/webhooks/provider",
    asyncHandler(async (req, res) => {
      const raw = (req as Request & { rawBody?: string }).rawBody;
      if (!raw) throw new HttpError(400, "Empty webhook body");
      verifyProviderSignature(raw, req.header("x-provider-signature"));
      const body = HttpErrorParser.parse(webhookSchema, req.body);
      const payment = await applyProviderEvent(ctx, body);
      res.json({ received: true, paymentId: payment.id, status: payment.status });
    }),
  );

  router.use(requireOperator(ctx));

  router.post(
    "/auth/logout",
    asyncHandler(async (req, res) => {
      const body = z
        .object({ refreshToken: z.string().optional(), sessionId: z.string().uuid().optional() })
        .parse(req.body ?? {});
      await logout(ctx, (req as AuthedRequest).operator.id, body.refreshToken, body.sessionId);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/auth/logout-all",
    asyncHandler(async (req, res) => {
      await logoutAll(ctx, (req as AuthedRequest).operator.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/auth/request-verification",
    asyncHandler(async (req, res) => {
      res.json(await requestVerification(ctx, (req as AuthedRequest).operator.id));
    }),
  );

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json({ user: publicUser((req as AuthedRequest).operator) });
    }),
  );

  router.get(
    "/me/sessions",
    asyncHandler(async (req, res) => {
      res.json({ sessions: await listSessions(ctx, (req as AuthedRequest).operator.id) });
    }),
  );

  router.delete(
    "/me/sessions/:id",
    asyncHandler(async (req, res) => {
      await revokeSession(ctx, (req as AuthedRequest).operator.id, req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    "/dashboard",
    asyncHandler(async (req, res) => {
      const operatorId = (req as AuthedRequest).operator.id;
      const grouped = await ctx.prisma.payment.groupBy({
        by: ["status"],
        where: { operatorId },
        _count: { _all: true },
      });
      const counts = {
        requires_confirmation: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
      };
      for (const row of grouped) {
        counts[row.status] = row._count._all;
      }
      const recentLedger = await ctx.prisma.ledgerEntry.findMany({
        where: { operatorId },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      res.json({
        counts,
        recentLedger: recentLedger.map((e) => ({
          id: e.id,
          paymentId: e.paymentId,
          refundId: e.refundId,
          account: e.account,
          direction: e.direction,
          amountCents: e.amountCents,
          currency: e.currency,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.post(
    "/customers",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(customerSchema, req.body);
      const customer = await ctx.prisma.customer.create({
        data: {
          operatorId: (req as AuthedRequest).operator.id,
          email: body.email,
          name: body.name,
        },
      });
      res.status(201).json(serializeCustomer(customer));
    }),
  );

  router.get(
    "/customers",
    asyncHandler(async (req, res) => {
      const customers = await ctx.prisma.customer.findMany({
        where: { operatorId: (req as AuthedRequest).operator.id },
        orderBy: { createdAt: "desc" },
      });
      res.json({ customers: customers.map(serializeCustomer) });
    }),
  );

  router.get(
    "/customers/:id",
    asyncHandler(async (req, res) => {
      const customer = await ctx.prisma.customer.findFirst({
        where: { id: req.params.id, operatorId: (req as AuthedRequest).operator.id },
      });
      if (!customer) throw new HttpError(404, "Customer not found");
      res.json(serializeCustomer(customer));
    }),
  );

  router.post(
    "/payments",
    requireIdempotency(ctx),
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(paymentSchema, req.body);
      const payment = await createPayment(ctx, (req as AuthedRequest).operator.id, body);
      res.status(201).json(serializePayment(payment));
    }),
  );

  router.get(
    "/payments",
    asyncHandler(async (req, res) => {
      const payments = await ctx.prisma.payment.findMany({
        where: { operatorId: (req as AuthedRequest).operator.id },
        orderBy: { createdAt: "desc" },
      });
      res.json({ payments: payments.map(serializePayment) });
    }),
  );

  router.get(
    "/payments/:id",
    asyncHandler(async (req, res) => {
      const payment = await ctx.prisma.payment.findFirst({
        where: { id: req.params.id, operatorId: (req as AuthedRequest).operator.id },
      });
      if (!payment) throw new HttpError(404, "Payment not found");
      res.json(serializePayment(payment));
    }),
  );

  router.get(
    "/payments/:id/events",
    asyncHandler(async (req, res) => {
      const payment = await ctx.prisma.payment.findFirst({
        where: { id: req.params.id, operatorId: (req as AuthedRequest).operator.id },
      });
      if (!payment) throw new HttpError(404, "Payment not found");
      const events = await ctx.prisma.paymentEvent.findMany({
        where: { paymentId: payment.id },
        orderBy: { createdAt: "asc" },
      });
      res.json({
        events: events.map((e) => ({
          id: e.id,
          paymentId: e.paymentId,
          type: e.type,
          data: e.data,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.post(
    "/payments/:id/confirm",
    asyncHandler(async (req, res) => {
      const payment = await confirmPayment(ctx, (req as AuthedRequest).operator.id, req.params.id);
      res.json(serializePayment(payment));
    }),
  );

  router.post(
    "/payments/:id/cancel",
    asyncHandler(async (req, res) => {
      const payment = await cancelPayment(ctx, (req as AuthedRequest).operator.id, req.params.id);
      res.json(serializePayment(payment));
    }),
  );

  router.post(
    "/refunds",
    optionalIdempotency(ctx),
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(refundSchema, req.body);
      const refund = await refundPayment(ctx, (req as AuthedRequest).operator.id, body.paymentId, body.amountCents);
      res.status(201).json(refund);
    }),
  );

  router.get(
    "/refunds",
    asyncHandler(async (req, res) => {
      const refunds = await ctx.prisma.refund.findMany({
        where: { operatorId: (req as AuthedRequest).operator.id },
        orderBy: { createdAt: "desc" },
      });
      res.json({
        refunds: refunds.map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          amountCents: r.amountCents,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.get(
    "/ledger",
    asyncHandler(async (req, res) => {
      const ledger = await ctx.prisma.ledgerEntry.findMany({
        where: { operatorId: (req as AuthedRequest).operator.id },
        orderBy: { createdAt: "desc" },
      });
      res.json({
        ledger: ledger.map((e) => ({
          id: e.id,
          paymentId: e.paymentId,
          refundId: e.refundId,
          account: e.account,
          direction: e.direction,
          amountCents: e.amountCents,
          currency: e.currency,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.get(
    "/audit",
    asyncHandler(async (req, res) => {
      const audit = await ctx.prisma.auditLog.findMany({
        where: { actorId: (req as AuthedRequest).operator.id },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({
        audit: audit.map((a) => ({
          id: a.id,
          actorId: a.actorId,
          action: a.action,
          resourceType: a.resourceType,
          resourceId: a.resourceId,
          metadata: a.metadata,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    }),
  );

  router.post(
    "/demo/simulate-provider",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(simulateSchema, req.body);
      const payment = await simulateProvider(ctx, (req as AuthedRequest).operator.id, body.paymentId, body.outcome);
      res.json(payment);
    }),
  );

  return router;
}
