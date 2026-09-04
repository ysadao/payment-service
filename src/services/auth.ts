import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { config } from "../config.js";
import type { AppContext } from "../context.js";
import { HttpError, publicUser } from "../types.js";

export const registerSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1),
});

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signAccess(user: User) {
  return jwt.sign({ sub: user.id, type: "access" }, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessTtl,
  } as jwt.SignOptions);
}

async function writeAudit(
  ctx: AppContext,
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await ctx.prisma.auditLog.create({
    data: { actorId, action, resourceType, resourceId, metadata: metadata as Prisma.InputJsonValue },
  });
}

export async function issueSession(ctx: AppContext, user: User, userAgent: string | null) {
  const refreshToken = randomBytes(48).toString("base64url");
  const session = await ctx.prisma.session.create({
    data: {
      userId: user.id,
      refreshHash: sha(refreshToken),
      userAgent,
      expiresAt: new Date(Date.now() + config.jwtRefreshTtlMs),
    },
  });
  return {
    accessToken: signAccess(user),
    refreshToken,
    sessionId: session.id,
    expiresIn: config.jwtAccessTtl,
    tokenType: "Bearer" as const,
  };
}

function withTokens<T extends Record<string, unknown>>(payload: T, extra?: Record<string, unknown>) {
  return config.demoExposeTokens ? { ...payload, ...extra } : payload;
}

export async function register(ctx: AppContext, input: z.infer<typeof registerSchema>, userAgent: string | null) {
  const passwordHash = await bcrypt.hash(input.password, config.bcryptRounds);
  let user: User;
  try {
    user = await ctx.prisma.user.create({
      data: { email: input.email, passwordHash },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") throw new HttpError(409, "Email already registered");
    throw err;
  }
  await writeAudit(ctx, user.id, "user.registered", "user", user.id, {});
  const verificationToken = await issueEmailVerification(ctx, user.id);
  const tokens = await issueSession(ctx, user, userAgent);
  return withTokens(
    { user: publicUser(user), ...tokens },
    { demoToken: verificationToken, verificationToken },
  );
}

export async function login(ctx: AppContext, input: z.infer<typeof loginSchema>, userAgent: string | null) {
  const user = await ctx.prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid credentials");
  }
  await writeAudit(ctx, user.id, "user.login", "user", user.id, {});
  const tokens = await issueSession(ctx, user, userAgent);
  return { user: publicUser(user), ...tokens };
}

export async function refresh(ctx: AppContext, refreshToken: string, userAgent: string | null) {
  const hash = sha(refreshToken);
  const session = await ctx.prisma.session.findUnique({ where: { refreshHash: hash } });
  if (!session) throw new HttpError(401, "Invalid refresh token");
  // Reuse of a rotated/revoked refresh is treated as theft: kill the whole family.
  if (session.revokedAt) {
    await ctx.prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(ctx, session.userId, "session.reuse_detected", "session", session.id, {
      reason: "revoked_refresh_presented",
    });
    throw new HttpError(401, "Invalid refresh token");
  }
  if (session.expiresAt.getTime() < Date.now()) throw new HttpError(401, "Refresh token expired");
  const user = await ctx.prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new HttpError(401, "User not found");
  await ctx.prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  await writeAudit(ctx, user.id, "session.rotated", "session", session.id, { sessionId: session.id });
  const tokens = await issueSession(ctx, user, userAgent);
  return { user: publicUser(user), ...tokens };
}

export async function logout(ctx: AppContext, userId: string, refreshToken?: string, sessionId?: string) {
  if (sessionId) {
    await ctx.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else if (refreshToken) {
    await ctx.prisma.session.updateMany({
      where: { userId, refreshHash: sha(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await ctx.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  await writeAudit(ctx, userId, "user.logout", "session", sessionId ?? null, { sessionId: sessionId ?? null });
}

export async function logoutAll(ctx: AppContext, userId: string) {
  await ctx.prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeAudit(ctx, userId, "user.logout_all", "session", null, {});
}

export async function listSessions(ctx: AppContext, userId: string) {
  const sessions = await ctx.prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return sessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    revokedAt: s.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeSession(ctx: AppContext, userId: string, sessionId: string) {
  const s = await ctx.prisma.session.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw new HttpError(404, "Session not found");
  await ctx.prisma.session.update({
    where: { id: s.id },
    data: { revokedAt: new Date() },
  });
  await writeAudit(ctx, userId, "session.revoked", "session", sessionId, { sessionId });
}

async function issueEmailVerification(ctx: AppContext, userId: string) {
  const token = randomBytes(24).toString("base64url");
  await ctx.prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

export async function requestVerification(ctx: AppContext, userId: string) {
  const token = await issueEmailVerification(ctx, userId);
  await writeAudit(ctx, userId, "email.verification_requested", "user", userId, {});
  return config.demoExposeTokens ? { ok: true as const, demoToken: token, verificationToken: token } : { ok: true as const };
}

export async function verifyEmail(ctx: AppContext, token: string) {
  const hash = sha(token);
  const row = await ctx.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.usedAt) throw new HttpError(400, "Invalid verification token");
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(400, "Verification token expired");
  await ctx.prisma.$transaction([
    ctx.prisma.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    ctx.prisma.emailVerificationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);
  await writeAudit(ctx, row.userId, "email.verified", "user", row.userId, {});
}

export async function forgotPassword(ctx: AppContext, email: string) {
  const user = await ctx.prisma.user.findUnique({ where: { email } });
  if (!user) return { ok: true as const };
  const token = randomBytes(24).toString("base64url");
  await ctx.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await writeAudit(ctx, user.id, "password.reset_requested", "user", user.id, {});
  return config.demoExposeTokens ? { ok: true as const, demoToken: token, resetToken: token } : { ok: true as const };
}

export async function resetPassword(ctx: AppContext, token: string, password: string) {
  const hash = sha(token);
  const row = await ctx.prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.usedAt) throw new HttpError(400, "Invalid reset token");
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(400, "Reset token expired");
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await ctx.prisma.$transaction([
    ctx.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    ctx.prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    ctx.prisma.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await writeAudit(ctx, row.userId, "password.reset_completed", "user", row.userId, {});
}
