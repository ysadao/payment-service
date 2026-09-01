process.env.BCRYPT_ROUNDS = "4";
process.env.DEMO_EXPOSE_TOKENS = "true";
process.env.DATABASE_URL ??= "postgresql://app:app@127.0.0.1:55432/payments";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.PORT ??= "0";
