import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import type { AppContext } from "../context.js";
import { HttpError } from "../types.js";
import type { AuthedRequest } from "./http.js";

export function requireIdempotency(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header("idempotency-key");
    if (!key) {
      next(new HttpError(400, "Idempotency-Key header is required"));
      return;
    }
    const operator = (req as AuthedRequest).operator;
    if (!operator) {
      next(new HttpError(401, "Authentication required"));
      return;
    }
    try {
      const pathAtEntry = req.originalUrl.split("?")[0] ?? req.path;
      const method = req.method.toUpperCase();
      const hash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");
      const existing = await ctx.prisma.idempotencyKey.findUnique({
        where: {
          operatorId_method_path_key: {
            operatorId: operator.id,
            method,
            path: pathAtEntry,
            key,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new HttpError(409, "Idempotency-Key reused with a different request");
        }
        if (existing.responseCode === 0) {
          throw new HttpError(409, "Idempotency-Key request is in progress");
        }
        res.status(existing.responseCode).json(existing.responseBody);
        return;
      }

      try {
        await ctx.prisma.idempotencyKey.create({
          data: {
            key,
            operatorId: operator.id,
            method,
            path: pathAtEntry,
            requestHash: hash,
            responseCode: 0,
            responseBody: {},
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const raced = await ctx.prisma.idempotencyKey.findUnique({
            where: {
              operatorId_method_path_key: {
                operatorId: operator.id,
                method,
                path: pathAtEntry,
                key,
              },
            },
          });
          if (!raced) throw new HttpError(409, "Idempotency-Key conflict");
          if (raced.requestHash !== hash) {
            throw new HttpError(409, "Idempotency-Key reused with a different request");
          }
          if (raced.responseCode === 0) {
            throw new HttpError(409, "Idempotency-Key request is in progress");
          }
          res.status(raced.responseCode).json(raced.responseBody);
          return;
        }
        throw err;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const status = res.statusCode || 200;
        void ctx.prisma.idempotencyKey
          .update({
            where: {
              operatorId_method_path_key: {
                operatorId: operator.id,
                method,
                path: pathAtEntry,
                key,
              },
            },
            data: { responseCode: status, responseBody: body as Prisma.InputJsonValue },
          })
          .catch(() => undefined)
          .finally(() => originalJson(body));
        return res;
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
