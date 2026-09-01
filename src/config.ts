import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env"), override: true });

export const config = {
  get port() {
    return Number(process.env.PORT ?? 3103);
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "postgresql://app:app@127.0.0.1:55432/payments";
  },
  get jwtAccessSecret() {
    return process.env.JWT_ACCESS_SECRET ?? "pay-demo-access-secret-change-me";
  },
  get jwtRefreshTtlMs() {
    return ttlMs(process.env.JWT_REFRESH_TTL ?? "7d");
  },
  get jwtAccessTtl() {
    return process.env.JWT_ACCESS_TTL ?? "15m";
  },
  get jwtRefreshTtl() {
    return process.env.JWT_REFRESH_TTL ?? "7d";
  },
  get providerWebhookSecret() {
    return process.env.PROVIDER_WEBHOOK_SECRET ?? "pay-demo-provider-hmac-secret";
  },
  get bcryptRounds() {
    return Number(process.env.BCRYPT_ROUNDS ?? 10);
  },
  get demoExposeTokens() {
    return (process.env.DEMO_EXPOSE_TOKENS ?? "true") === "true";
  },
};

function ttlMs(ttl: string) {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 7 * 86400_000;
  const n = Number(m[1]);
  const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * map[m[2]];
}
