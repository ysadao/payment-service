import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4103),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "pay-demo-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "pay-demo-refresh-secret-change-me",
  providerWebhookSecret: process.env.PROVIDER_WEBHOOK_SECRET ?? "pay-demo-provider-hmac-secret",
  get bcryptRounds() {
    return Number(process.env.BCRYPT_ROUNDS ?? 10);
  },
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, "../data")),
};
