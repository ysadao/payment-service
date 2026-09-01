import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AppContext } from "./context.js";
import { errorHandler, asyncHandler } from "./middleware/http.js";
import { readiness, requestContext, securityHeaders, openApiSpec } from "./observability.js";
import { buildRouter } from "./routes/api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../web/dist");

const DOCS = {
  title: "Ledger Operator Console",
  note: "FinTech payments API with Prisma/Postgres, session auth, idempotent captures, and HMAC webhooks.",
  endpoints: [
    { method: "GET", path: "/health" },
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/api/docs" },
    { method: "POST", path: "/api/auth/register" },
    { method: "POST", path: "/api/auth/login" },
    { method: "POST", path: "/api/auth/refresh" },
    { method: "POST", path: "/api/auth/logout" },
    { method: "POST", path: "/api/auth/logout-all" },
    { method: "POST", path: "/api/auth/forgot-password" },
    { method: "POST", path: "/api/auth/reset-password" },
    { method: "POST", path: "/api/auth/request-verification" },
    { method: "POST", path: "/api/auth/verify-email" },
    { method: "GET", path: "/api/me" },
    { method: "GET", path: "/api/me/sessions" },
    { method: "DELETE", path: "/api/me/sessions/:id" },
    { method: "GET", path: "/api/dashboard" },
    { method: "POST", path: "/api/customers" },
    { method: "GET", path: "/api/customers" },
    { method: "GET", path: "/api/customers/:id" },
    { method: "POST", path: "/api/payments", headers: ["Idempotency-Key (required)"] },
    { method: "GET", path: "/api/payments" },
    { method: "GET", path: "/api/payments/:id" },
    { method: "GET", path: "/api/payments/:id/events" },
    { method: "POST", path: "/api/payments/:id/confirm" },
    { method: "POST", path: "/api/payments/:id/cancel" },
    { method: "POST", path: "/api/refunds" },
    { method: "GET", path: "/api/ledger" },
    { method: "GET", path: "/api/audit" },
    { method: "POST", path: "/api/webhooks/provider", headers: ["x-provider-signature"] },
    { method: "POST", path: "/api/demo/simulate-provider" },
  ],
};

export function createApp(ctx: AppContext) {
  const app = express();
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );

  const health = (_req: express.Request, res: express.Response) => {
    res.json({ status: "ok", service: "payment-service", time: new Date().toISOString() });
  };
  app.get("/health", health);
  app.get("/api/health", health);
  app.get("/api/ready", asyncHandler(readiness));
  app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));
  app.get("/api/docs", (_req, res) => res.json(DOCS));
  app.use("/api", buildRouter(ctx));

  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.method !== "GET") {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
