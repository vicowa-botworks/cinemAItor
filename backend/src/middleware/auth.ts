import type { Context, Next } from "@oak/oak";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { verifyToken } from "@cinemaItor/services/jwt.ts";
import { isSessionValid } from "@cinemaItor/services/sessions.ts";

export interface AuthedContext extends Context {
  userId?: number;
  userRole?: string;
  token?: string;
}

export async function authMiddleware(
  ctx: AuthedContext,
  next: Next,
): Promise<void> {
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Missing or invalid authorization header" };
    return;
  }

  const token = authHeader.substring(7);
  const payload = await verifyToken(token);

  if (!payload) {
    ctx.response.status = 401;
    ctx.response.body = {
      error: "Invalid or expired token",
    };
    return;
  }

  const user = getUserById(payload.sub);
  if (!user || !user.is_active) {
    ctx.response.status = 401;
    ctx.response.body = { error: "User not found or inactive" };
    return;
  }

  const sessionValid = await isSessionValid(token);
  if (!sessionValid) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Session revoked or expired" };
    return;
  }

  ctx.userId = user.id;
  ctx.userRole = user.role;
  ctx.token = token;
  await next();
}

export { verifyToken } from "@cinemaItor/services/jwt.ts";
export { generateToken } from "@cinemaItor/services/jwt.ts";
