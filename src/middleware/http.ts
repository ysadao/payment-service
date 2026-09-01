import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import { HttpError, type Operator } from "../types.js";

export class HttpErrorParser {
  static parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
    const result = schema.safeParse(data);
    if (!result.success) throw new HttpError(400, "Validation failed", result.error.flatten());
    return result.data;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details ?? null });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export interface AuthedRequest extends Request {
  operator: Operator;
}

export function requireOperator(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? "";
      if (!header.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");
      let payload: jwt.JwtPayload;
      try {
        payload = jwt.verify(header.slice(7), config.jwtAccessSecret) as jwt.JwtPayload;
      } catch {
        throw new HttpError(401, "Invalid or expired access token");
      }
      if (typeof payload.sub !== "string") throw new HttpError(401, "Invalid token");
      const op = (await ctx.store.read()).operators.find((o) => o.id === payload.sub);
      if (!op) throw new HttpError(401, "Operator not found");
      (req as AuthedRequest).operator = op;
      next();
    } catch (err) {
      next(err);
    }
  };
}
