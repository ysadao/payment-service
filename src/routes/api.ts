import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import { asyncHandler, type AuthedRequest, HttpErrorParser, requireOperator } from "../middleware/http.js";
import { optionalIdempotency, requireIdempotency } from "../middleware/idempotency.js";
import { HttpError } from "../types.js";
import {
  applyProviderEvent,
  cancelPayment,
  confirmPayment,
  createPayment,
  refundPayment,
  verifyProviderSignature,
} from "../services/payments.js";

const registerSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(8),
});
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

export function buildRouter(ctx: AppContext) {
  const router = Router();

  router.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(registerSchema, req.body);
      const passwordHash = await bcrypt.hash(body.password, config.bcryptRounds);
      const op = {
        id: randomUUID(),
        email: body.email,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.update((db) => {
        if (db.operators.some((o) => o.email === body.email)) throw new HttpError(409, "Email already registered");
        db.operators.push(op);
      });
      const accessToken = jwt.sign({ sub: op.id, type: "access" }, config.jwtAccessSecret, { expiresIn: "8h" });
      res.status(201).json({ accessToken, operator: { id: op.id, email: op.email } });
    }),
  );

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(registerSchema, req.body);
      const op = (await ctx.store.read()).operators.find((o) => o.email === body.email);
      if (!op || !(await bcrypt.compare(body.password, op.passwordHash))) {
        throw new HttpError(401, "Invalid credentials");
      }
      const accessToken = jwt.sign({ sub: op.id, type: "access" }, config.jwtAccessSecret, { expiresIn: "8h" });
      res.json({ accessToken, operator: { id: op.id, email: op.email } });
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
    "/customers",
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(customerSchema, req.body);
      const customer = {
        id: randomUUID(),
        email: body.email,
        name: body.name,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.update((db) => {
        db.customers.push(customer);
      });
      res.status(201).json(customer);
    }),
  );

  router.get(
    "/customers",
    asyncHandler(async (_req, res) => {
      res.json({ customers: (await ctx.store.read()).customers });
    }),
  );

  router.get(
    "/customers/:id",
    asyncHandler(async (req, res) => {
      const customer = (await ctx.store.read()).customers.find((c) => c.id === req.params.id);
      if (!customer) throw new HttpError(404, "Customer not found");
      res.json(customer);
    }),
  );

  router.post(
    "/payments",
    requireIdempotency(ctx),
    asyncHandler(async (req, res) => {
      const body = HttpErrorParser.parse(paymentSchema, req.body);
      const payment = await createPayment(ctx, (req as AuthedRequest).operator.id, body);
      res.status(201).json(payment);
    }),
  );

  router.get(
    "/payments",
    asyncHandler(async (_req, res) => {
      res.json({ payments: (await ctx.store.read()).payments });
    }),
  );

  router.get(
    "/payments/:id",
    asyncHandler(async (req, res) => {
      const payment = (await ctx.store.read()).payments.find((p) => p.id === req.params.id);
      if (!payment) throw new HttpError(404, "Payment not found");
      res.json(payment);
    }),
  );

  router.get(
    "/payments/:id/events",
    asyncHandler(async (req, res) => {
      const db = await ctx.store.read();
      if (!db.payments.some((p) => p.id === req.params.id)) throw new HttpError(404, "Payment not found");
      res.json({ events: db.events.filter((e) => e.paymentId === req.params.id) });
    }),
  );

  router.post(
    "/payments/:id/confirm",
    asyncHandler(async (req, res) => {
      const payment = await confirmPayment(ctx, (req as AuthedRequest).operator.id, req.params.id);
      res.json(payment);
    }),
  );

  router.post(
    "/payments/:id/cancel",
    asyncHandler(async (req, res) => {
      const payment = await cancelPayment(ctx, (req as AuthedRequest).operator.id, req.params.id);
      res.json(payment);
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
    "/ledger",
    asyncHandler(async (_req, res) => {
      res.json({ ledger: (await ctx.store.read()).ledger });
    }),
  );

  router.get(
    "/audit",
    asyncHandler(async (_req, res) => {
      res.json({ audit: (await ctx.store.read()).audit });
    }),
  );

  return router;
}
