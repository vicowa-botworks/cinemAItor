import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { authRateLimitMiddleware } from "@cinemaItor/middleware/rate_limit.ts";
import {
  countUsers,
  createUser,
  deleteUserById,
  getUserByEmail,
  getUserById,
  setUserMustChangePassword,
  setUserPassword,
} from "@cinemaItor/db/schema.ts";
import { getSetting } from "@cinemaItor/db/settings.ts";
import { hashPassword, verifyPassword } from "@cinemaItor/services/password.ts";
import { issueSession, revokeSession } from "@cinemaItor/services/sessions.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import {
  AppError,
  badRequest,
  conflict,
  ERROR_CODES,
  forbidden,
  notFound,
  unauthorized,
} from "@cinemaItor/errors.ts";
import {
  confirmEmailByToken,
  confirmPasswordReset,
  resendEmailConfirmation,
  sendEmailConfirmationEmail,
  sendPasswordResetEmail,
} from "@cinemaItor/services/email_flows.ts";
import { isMailAvailable } from "@cinemaItor/services/mail.ts";
import { SmtpError } from "@cinemaItor/services/smtp.ts";

const MIN_PASSWORD_LENGTH = 8;

function userShape(user: {
  id: number;
  email: string;
  display_name: string;
  role: string;
  must_change_password: number;
  email_confirmed?: number;
}) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    must_change_password: user.must_change_password === 1,
    email_confirmed: (user.email_confirmed ?? 1) === 1,
  };
}

// Wraps SMTP transport failures as a 503; rethrows anything else untouched.
function toMailDeliveryError(err: unknown, action: string): never {
  if (err instanceof SmtpError) {
    throw new AppError(
      ERROR_CODES.NETWORK_ERROR,
      `Failed to ${action} via SMTP: ${err.message}`,
      { status: 503 },
    );
  }
  throw err;
}

function mailNotConfiguredError(action: string): never {
  throw new AppError(
    ERROR_CODES.NETWORK_ERROR,
    `Email delivery is not configured on this server (SMTP settings are missing), so we cannot ${action}`,
    { status: 503 },
  );
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
      email_confirmed: true,
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

  // When mail delivery is available and confirmation is enabled (default),
  // the account starts unconfirmed and must open the confirmation link
  // before signing in. Otherwise the legacy immediate-access behavior
  // applies (no session is issued until the address is confirmed).
  const confirmationRequired = isMailAvailable() &&
    getSetting("email_confirmation_required", "1") === "1";

  let userId: number;
  try {
    userId = createUser(
      email,
      await hashPassword(password),
      body.display_name,
      "user",
      false,
      !confirmationRequired,
    );
  } catch (err) {
    if (getUserByEmail(email)) throw conflict("Email already registered");
    throw err;
  }

  if (!confirmationRequired) {
    const token = await issueSession(userId);
    logAudit(userId, "user.register", "user", String(userId));
    ctx.response.status = 201;
    ctx.response.body = {
      token,
      user: userShape(getUserById(userId)!),
    };
    return;
  }

  try {
    const result = await sendEmailConfirmationEmail(userId);
    if (!result.sent) deleteUserById(userId);
  } catch (err) {
    // Never strand an account the user cannot confirm.
    deleteUserById(userId);
    toMailDeliveryError(err, "send the confirmation email");
  }
  logAudit(userId, "user.register", "user", String(userId), {
    email_confirmation: true,
  });
  ctx.response.status = 201;
  ctx.response.body = {
    user: userShape(getUserById(userId)!),
    message: "Account created. Open the confirmation link in your inbox to activate it.",
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
  if (!user.email_confirmed) {
    throw new AppError(
      ERROR_CODES.EMAIL_NOT_CONFIRMED,
      "Please confirm your email address before signing in",
      { status: 403 },
    );
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
  ctx.response.body = {
    registered: countUsers() > 0,
    registration_enabled: getSetting("registration_enabled", "1") === "1",
  };
}

async function handlePasswordResetRequest(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (typeof body.email !== "string" || !body.email.trim()) {
    throw badRequest("Email is required");
  }
  if (!isMailAvailable()) mailNotConfiguredError("send password reset emails");
  try {
    // Always answers the same way, whether or not the address has an
    // account, so the endpoint cannot be used for account enumeration.
    await sendPasswordResetEmail(body.email.trim().toLowerCase());
  } catch (err) {
    toMailDeliveryError(err, "send the password reset email");
  }
  logAudit(null, "auth.password_reset_requested", "user", body.email.trim().toLowerCase());
  ctx.response.status = 202;
  ctx.response.body = {
    message: "If that email has an account, a password reset link has been sent.",
  };
}

async function handlePasswordResetConfirm(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (typeof body.token !== "string" || !body.token.trim()) {
    throw badRequest("A reset token is required");
  }
  if (typeof body.new_password !== "string") {
    throw badRequest("new_password is required");
  }
  if (body.new_password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  await confirmPasswordReset(body.token.trim(), body.new_password);
  ctx.response.body = {
    message: "Password updated. You can now sign in.",
  };
}

async function handleEmailConfirmationConfirm(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (typeof body.token !== "string" || !body.token.trim()) {
    throw badRequest("A confirmation token is required");
  }
  await confirmEmailByToken(body.token.trim());
  ctx.response.body = {
    message: "Email confirmed. You can now sign in.",
  };
}

async function handleEmailConfirmationResend(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  if (typeof body.email !== "string" || !body.email.trim()) {
    throw badRequest("Email is required");
  }
  if (!isMailAvailable()) {
    mailNotConfiguredError("resend confirmation emails");
  }
  const email = body.email.trim().toLowerCase();
  try {
    await resendEmailConfirmation(email);
  } catch (err) {
    toMailDeliveryError(err, "send the confirmation email");
  }
  ctx.response.status = 202;
  ctx.response.body = {
    message: "If that email has an unconfirmed account, a new confirmation link has been sent.",
  };
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
  .post(
    "/api/v1/auth/password-reset/request",
    authRateLimitMiddleware,
    handlePasswordResetRequest,
  )
  .post(
    "/api/v1/auth/password-reset/confirm",
    authRateLimitMiddleware,
    handlePasswordResetConfirm,
  )
  .post(
    "/api/v1/auth/email-confirmation/confirm",
    authRateLimitMiddleware,
    handleEmailConfirmationConfirm,
  )
  .post(
    "/api/v1/auth/email-confirmation/resend",
    authRateLimitMiddleware,
    handleEmailConfirmationResend,
  )
  .post("/api/auth/register", authRateLimitMiddleware, handleRegister)
  .post("/api/auth/login", authRateLimitMiddleware, handleLogin)
  .get("/api/auth/me", authMiddleware, handleMe);
