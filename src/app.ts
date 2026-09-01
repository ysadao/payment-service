import express from "express";
import type { AppContext } from "./context.js";
import { errorHandler } from "./middleware/http.js";
import { buildRouter } from "./routes/api.js";

const DOCS = {
  title: "Payment Service",
  note: "Portfolio/reference implementation demonstrating production patterns.",
  endpoints: [
    { method: "GET", path: "/health" },
    { method: "GET", path: "/docs" },
    { method: "POST", path: "/auth/register" },
    { method: "POST", path: "/auth/login" },
    { method: "POST", path: "/customers" },
    { method: "GET", path: "/customers" },
    { method: "GET", path: "/customers/:id" },
    { method: "POST", path: "/payments", headers: ["Idempotency-Key (required)"] },
    { method: "GET", path: "/payments" },
    { method: "GET", path: "/payments/:id" },
    { method: "GET", path: "/payments/:id/events" },
    { method: "POST", path: "/payments/:id/confirm" },
    { method: "POST", path: "/payments/:id/cancel" },
    { method: "POST", path: "/refunds" },
    { method: "GET", path: "/ledger" },
    { method: "GET", path: "/audit" },
    { method: "POST", path: "/webhooks/provider", headers: ["x-provider-signature"] },
  ],
};

export function createApp(ctx: AppContext) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "payment-service", time: new Date().toISOString() });
  });
  app.get("/docs", (_req, res) => res.json(DOCS));
  app.use(buildRouter(ctx));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
