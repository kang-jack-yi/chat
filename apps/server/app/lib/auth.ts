import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Application, Context } from "egg";
import { Op } from "sequelize";
import { toPlain } from "./database";

export interface TokenPayload {
  userId: number;
  companyId: number;
  role: "owner" | "admin" | "member";
  tokenType: "access" | "refresh";
  sessionId?: string;
}

const REFRESH_COOKIE = "chat_refresh";

function signToken(
  app: Application,
  user: any,
  tokenType: TokenPayload["tokenType"],
  expiresIn: "15m" | "7d",
  sessionId?: string,
) {
  return jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      tokenType,
      ...(sessionId ? { sessionId } : {}),
    } satisfies TokenPayload,
    app.config.jwtSecret,
    { expiresIn },
  );
}

export const signAccessToken = (app: Application, user: any) => signToken(app, user, "access", "15m");

function hashRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshSession(app: Application, ctx: Context, user: any) {
  const sessionId = crypto.randomUUID();
  const token = signToken(app, user, "refresh", "7d", sessionId);
  await app.chatDb.DesktopRefreshSession.create({
    id: sessionId,
    userId: user.id,
    companyId: user.companyId,
    deviceId: String(ctx.get("x-desktop-device-id") || ctx.get("user-agent") || "desktop").slice(0, 80),
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastUsedAt: new Date(),
  });
  return token;
}

export async function resolveRefreshSession(app: Application, token?: string) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, app.config.jwtSecret) as TokenPayload;
    if (payload.tokenType !== "refresh" || !payload.sessionId) return null;
    const session = await app.chatDb.DesktopRefreshSession.findOne({
      where: {
        id: payload.sessionId,
        userId: payload.userId,
        companyId: payload.companyId,
        tokenHash: hashRefreshToken(token),
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
    if (!session) return null;
    const user = await app.chatDb.User.findOne({
      where: { id: payload.userId, companyId: payload.companyId, status: "active" },
    });
    if (!user) return null;
    await session.update({ lastUsedAt: new Date() });
    return { user: toPlain(user), session };
  } catch {
    return null;
  }
}

export async function revokeRefreshSession(app: Application, token?: string) {
  if (!token) return;
  try {
    const payload = jwt.verify(token, app.config.jwtSecret) as TokenPayload;
    if (payload.tokenType !== "refresh" || !payload.sessionId) return;
    await app.chatDb.DesktopRefreshSession.update(
      { revokedAt: new Date() },
      { where: { id: payload.sessionId, tokenHash: hashRefreshToken(token), revokedAt: null } },
    );
  } catch {
    // Invalid or expired tokens are already unusable.
  }
}

export async function resolveSession(
  app: Application,
  token?: string,
  tokenType: TokenPayload["tokenType"] = "access",
): Promise<any | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, app.config.jwtSecret) as TokenPayload;
    if (payload.tokenType !== tokenType) return null;
    const row = await app.chatDb.User.findOne({ where: { id: payload.userId, companyId: payload.companyId, status: "active" } });
    return row ? toPlain(row) : null;
  } catch {
    return null;
  }
}

export function bearerToken(ctx: Context) {
  const match = String(ctx.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function refreshCookie(ctx: Context) {
  return ctx.cookies.get(REFRESH_COOKIE, { signed: false });
}

export function setRefreshCookie(ctx: Context, token: string | null) {
  const desktopOrigin = String(ctx.get("origin") || "").startsWith("chat://");
  ctx.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: desktopOrigin ? "none" : "lax",
    signed: false,
    secure: desktopOrigin || ctx.secure || ctx.app.config.env === "prod",
    overwrite: true,
    path: "/api/auth",
    maxAge: token ? 7 * 24 * 60 * 60 * 1000 : 0,
  });
}

export function publicUser(user: any, departmentName?: string) {
  return {
    id: user.id,
    companyId: user.companyId,
    departmentId: user.departmentId,
    phone: user.phone,
    name: user.name,
    title: user.title || "",
    avatar: user.avatar || user.name?.slice(0, 1) || "企",
    role: user.role,
    status: user.status,
    departmentName,
  };
}

export function ok(ctx: Context, data: any) {
  ctx.body = { success: true, data };
}

export function fail(ctx: Context, status: number, code: string, message: string) {
  ctx.status = status;
  ctx.body = { success: false, error: { code, message } };
}

export function requireAdmin(ctx: Context) {
  if (!ctx.currentUser || !["owner", "admin"].includes(ctx.currentUser.role)) {
    fail(ctx, 403, "FORBIDDEN", "仅企业所有者或管理员可以执行此操作");
    return false;
  }
  return true;
}
