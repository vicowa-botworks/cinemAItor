import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { authRateLimitMiddleware } from "@cinemaItor/middleware/rate_limit.ts";
import {
  countUsers,
  createUser,
  getUserByEmail,
  getUserById,
  setUserMustChangePassword,
  setUserPassword,
} from "@cinemaItor/db/schema.ts";
import { getSetting } from "@cinemaItor/db/settings.ts";
import { hashPassword, verifyPassword } from "@cinemaItor/services/password.ts";
import { issueSession, revokeSession } from "@cinemaItor/services/sessions.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";

const MIN_PASSWORD_LENGTH = 8;

function userShape(user: {
  id: number;
  email: string;
  display_name: string;
  role: string;
  must_change_password: number;
}) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    must_change_password: user.must_change_password === 1,
  };
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function validateCredentials(
  email: unknown,
  password: unknown,
): { email: string; password: string } {
  if (
    typeof email !== "string" || !email || typeof password !== "string" ||
    !password
  ) {
    throw badRequest("Email and password are required");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  return { email, password };
}

async function handleBootstrap(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (
    typeof body.email !== "string" || !body.email ||
    typeof body.display_name !== "string" || !body.display_name
  ) {
    throw badRequest("Email and display_name are required");
  }
  const { email, password } = validateCredentials(
    body.email,
    body.password,
  );
  if (countUsers() > 0) {
    throw conflict(
      "A user already exists; bootstrap is only available for the first user",
    );
  }

  const userId = createUser(
    email,
    await hashPassword(password),
    body.display_name,
    "admin",
  );
  const token = await issueSession(userId);
  logAudit(userId, "user.bootstrap", "user", String(userId));

  ctx.response.status = 201;
  ctx.response.body = {
    token,
    user: {
      id: userId,
      email,
      display_name: body.display_name,
      role: "admin",
      must_change_password: false,
    },
  };
}

async function handleRegister(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (
    typeof body.email !== "string" || !body.email ||
    typeof body.display_name !== "string" || !body.display_name
  ) {
    throw badRequest("Email, password, and display_name are required");
  }
  const { email, password } = validateCredentials(
    body.email,
    body.password,
  );
  if (getSetting("registration_enabled", "1") !== "1") {
    throw forbidden("Self-registration is disabled");
  }
  if (getUserByEmail(email)) {
    throw conflict("Email already registered");
  }

  const userId = createUser(
    email,
    await hashPassword(password),
    body.display_name,
  );
  const token = await issueSession(userId);
  logAudit(userId, "user.register", "user", String(userId));

  ctx.response.status = 201;
  ctx.response.body = {
    token,
    user: {
      id: userId,
      email,
      display_name: body.display_name,
      role: "user",
      must_change_password: false,
    },
  };
}

async function handleLogin(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  const { email, password } = validateCredentials(
    body.email,
    body.password,
  );

  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw unauthorized("Invalid credentials");
  }
  if (!user.is_active) {
    throw unauthorized("User is inactive");
  }

  const token = await issueSession(user.id);
  logAudit(user.id, "auth.login", "user", String(user.id));

  ctx.response.body = { token, user: userShape(user) };
}

async function handleChangePassword(ctx: Context): Promise<void> {
  const authed = ctx as AuthedContext;
  const userId = authed.userId;
  if (!userId) throw unauthorized();
  const user = getUserById(userId);
  if (!user) throw notFound("User not found");

  const body = await readJsonBody(ctx);
  if (
    typeof body.current_password !== "string" ||
    typeof body.new_password !== "string"
  ) {
    throw badRequest("current_password and new_password are required");
  }
  if (
    !(await verifyPassword(body.current_password, user.password_hash))
  ) {
    throw unauthorized("Current password is incorrect");
  }
  if (body.new_password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  setUserPassword(userId, await hashPassword(body.new_password));
  setUserMustChangePassword(userId, false);
  logAudit(userId, "auth.password_change", "user", String(userId));
  ctx.response.body = { user: userShape(getUserById(userId)!) };
}

function handleSetupStatus(ctx: Context): void {
  ctx.response.body = { registered: countUsers() > 0 };
}

function handleLogout(ctx: Context): void {
  const authed = ctx as AuthedContext;
  if (!authed.sessionId) throw unauthorized();
  const revoked = revokeSession(authed.sessionId);
  if (!revoked) throw unauthorized("Session already revoked");
  logAudit(authed.userId ?? null, "auth.logout", "user", String(authed.userId));
  ctx.response.status = 204;
}

function handleMe(ctx: Context): void {
  const authed = ctx as AuthedContext;
  const user = authed.userId ? getUserById(authed.userId) : undefined;
  if (!user) throw notFound("User not found");
  ctx.response.body = userShape(user);
}

export const router = new Router()
  .post("/api/v1/auth/bootstrap", authRateLimitMiddleware, handleBootstrap)
  .post("/api/v1/auth/login", authRateLimitMiddleware, handleLogin)
  .post("/api/v1/auth/logout", authMiddleware, handleLogout)
  .put("/api/v1/auth/password", authMiddleware, handleChangePassword)
  .get("/api/v1/auth/me", authMiddleware, handleMe)
  .get("/api/v1/auth/setup-status", handleSetupStatus)
  .post("/api/auth/register", authRateLimitMiddleware, handleRegister)
  .post("/api/auth/login", authRateLimitMiddleware, handleLogin)
  .get("/api/auth/me", authMiddleware, handleMe);
