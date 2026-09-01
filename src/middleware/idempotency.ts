import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppContext } from "../context.js";
import { HttpError, type IdempotencyRecord, type Operator } from "../types.js";

export function requireIdempotency(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("idempotency-key");
    if (!key) {
      next(new HttpError(400, "Idempotency-Key header is required"));
      return;
    }
    const operator = (req as Request & { operator?: Operator }).operator;
    if (!operator) {
      next(new HttpError(401, "Authentication required"));
      return;
    }
    try {
      const pathAtEntry = req.originalUrl.split("?")[0];
      const memKey = `${operator.id}:${pathAtEntry}:${key}`;
      const hash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");
      const existing =
        ctx.idempotency.get(memKey) ??
        (await ctx.store.read()).idempotency.find(
          (r) => r.operatorId === operator.id && r.key === key && r.path === pathAtEntry,
        );
      if (existing) {
        ctx.idempotency.set(memKey, existing);
        if (existing.requestHash !== hash) {
          throw new HttpError(409, "Idempotency-Key reused with a different request");
        }
        res.status(existing.status).json(existing.body);
        return;
      }
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const status = res.statusCode || 200;
        const record: IdempotencyRecord = {
          key,
          operatorId: operator.id,
          path: pathAtEntry,
          requestHash: hash,
          status,
          body,
          createdAt: new Date().toISOString(),
        };
        ctx.idempotency.set(memKey, record);
        void ctx.store.update((db) => {
          if (!db.idempotency.some((r) => r.operatorId === operator.id && r.key === key && r.path === pathAtEntry)) {
            db.idempotency.push(record);
          }
        });
        return originalJson(body);
      }) as typeof res.json;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function optionalIdempotency(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.header("idempotency-key")) {
      next();
      return;
    }
    void requireIdempotency(ctx)(req, res, next);
  };
}

export { randomUUID };
