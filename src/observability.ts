import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  const started = Date.now();
  res.on("finish", () => {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "http_request",
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
      })}\n`,
    );
  });
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  next();
}

export async function readiness(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready", db: "up", service: "payment-service" });
  } catch {
    res.status(503).json({ status: "not_ready", db: "down", service: "payment-service" });
  }
}

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Ledger Payments API",
    version: "2.1.0",
    description: "Idempotent payment intents, HMAC provider webhooks, hashed refresh sessions.",
  },
  paths: {
    "/api/ready": { get: { summary: "Postgres ping", responses: { "200": { description: "ready" }, "503": { description: "not ready" } } } },
    "/api/payments": {
      post: {
        summary: "Create payment (Idempotency-Key required)",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Created or replayed" } },
      },
    },
    "/api/webhooks/provider": {
      post: { summary: "HMAC-signed provider webhook", responses: { "200": { description: "Applied or deduped" }, "401": { description: "Bad signature" } } },
    },
  },
} as const;
