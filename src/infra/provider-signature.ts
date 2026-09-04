/**
 * Provider webhook crypto adapter (Stripe-style t=,v1= HMAC).
 * Kept out of the domain so payment rules do not depend on Node crypto details.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../types.js";

export function signProviderPayload(
  rawBody: string,
  secret = config.providerWebhookSecret,
  ts = Math.floor(Date.now() / 1000),
) {
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
