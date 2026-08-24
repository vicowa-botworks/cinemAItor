import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  countActiveAdmins,
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
  setUserActive,
  setUserEmailConfirmed,
  setUserMustChangePassword,
  setUserPassword,
  setUserRole,
  updateDisplayName,
  type User,
} from "@cinemaItor/db/schema.ts";
import { getSetting, setSetting } from "@cinemaItor/db/settings.ts";
import { hashPassword } from "@cinemaItor/services/password.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import {
  getEmailSettings,
  isMailAvailable,
  isValidTlsMode,
  type MailResult,
  sendMail,
  setEmailSetting,
} from "@cinemaItor/services/mail.ts";
import { SmtpError } from "@cinemaItor/services/smtp.ts";
import {
  AppError,
  badRequest,
  conflict,
  ERROR_CODES,
  forbidden,
  notFound,
  unauthorized,
} from "@cinemaItor/errors.ts";

const MIN_PASSWORD_LENGTH = 8;
const REGISTRATION_KEY = "registration_enabled";

interface ParamContext extends AuthedContext {
  params: { id?: string };
}

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAdmin(ctx: Context): number {
  const userId = requireUserId(ctx);
  const user = getUserById(userId);
  if (!user || user.role !== "admin") {
    throw forbidden("Admin role required");
  }
  return userId;
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    is_active: user.is_active === 1,
    must_change_password: user.must_change_password === 1,
    email_confirmed: user.email_confirmed === 1,
    created_at: user.created_at,
  };
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function asOptionalBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function validateRole(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value !== "user" && value !== "admin") {
    throw badRequest("role must be 'user' or 'admin'");
  }
  return value;
}

function handleListUsers(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = { users: listUsers().map(publicUser) };
}

async function handleCreateUser(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  if (
    typeof body.email !== "string" || !body.email ||
    typeof body.display_name !== "string" || !body.display_name ||
    typeof body.password !== "string" || !body.password
  ) {
    throw badRequest("email, display_name, and password are required");
  }
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (getUserByEmail(body.email)) {
    throw conflict("Email already registered");
  }
  const role = validateRole(body.role) ?? "user";
  const mustChangePassword = asOptionalBool(body.must_change_password) ?? true;

  const userId = createUser(
    body.email,
    await hashPassword(body.password),
    body.display_name,
    role,
    mustChangePassword,
  );
  logAudit(adminId, "user.create", "user", String(userId));
  ctx.response.status = 201;
  ctx.response.body = { user: publicUser(getUserById(userId)!) };
}

// Lock out protection: the last active admin cannot be demoted, deactivated
// or deleted (including self-modification), or the instance would have no
// way to regain admin access.
function guardLastAdmin(target: User): void {
  if (
    target.role === "admin" && target.is_active === 1 &&
    countActiveAdmins() <= 1
  ) {
    throw conflict(
      "Cannot demote, deactivate, or delete the last active admin",
    );
  }
}

async function handleUpdateUser(ctx: ParamContext): Promise<void> {
  const adminId = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid user id");
  const target = getUserById(id);
  if (!target) throw notFound("User not found");

  const body = await readJsonBody(ctx);
  const changes: string[] = [];

  const role = validateRole(body.role);
  if (role !== undefined && role !== target.role) {
    if (role === "user") guardLastAdmin(target);
    setUserRole(id, role);
    changes.push("role");
  }

  const isActive = asOptionalBool(body.is_active);
  if (isActive !== undefined && isActive !== (target.is_active === 1)) {
    if (!isActive) {
      guardLastAdmin(target);
      if (id === adminId) {
        throw conflict("Cannot deactivate your own account");
      }
    }
    setUserActive(id, isActive);
    changes.push("is_active");
  }

  const mustChange = asOptionalBool(body.must_change_password);
  if (mustChange !== undefined && mustChange !== (target.must_change_password === 1)) {
    setUserMustChangePassword(id, mustChange);
    changes.push("must_change_password");
  }

  const emailConfirmed = asOptionalBool(body.email_confirmed);
  if (emailConfirmed !== undefined && emailConfirmed !== (target.email_confirmed === 1)) {
    setUserEmailConfirmed(id, emailConfirmed);
    changes.push("email_confirmed");
  }

  if (typeof body.display_name === "string" && body.display_name) {
    if (body.display_name !== target.display_name) {
      updateDisplayName(id, body.display_name);
      changes.push("display_name");
    }
  }

  if (typeof body.password === "string" && body.password) {
    if (body.password.length < MIN_PASSWORD_LENGTH) {
      throw badRequest(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    setUserPassword(id, await hashPassword(body.password));
    // A password reset assigns a new temporary password: force a change
    // at next login unless the admin explicitly said otherwise.
    setUserMustChangePassword(id, asOptionalBool(body.must_change_password) ?? true);
    changes.push("password");
  }

  if (changes.length === 0) throw badRequest("No valid fields to update");
  logAudit(adminId, "user.update", "user", String(id), { fields: changes });
  ctx.response.body = { user: publicUser(getUserById(id)!) };
}

function handleDeleteUser(ctx: ParamContext): void {
  const adminId = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid user id");
  const target = getUserById(id);
  if (!target) throw notFound("User not found");
  if (id === adminId) throw conflict("Cannot delete your own account");
  guardLastAdmin(target);
  // Soft delete: existing sessions die via the is_active check in the auth
  // middleware, ownership columns keep referential integrity.
  setUserActive(id, false);
  logAudit(adminId, "user.delete", "user", String(id));
  ctx.response.status = 204;
}

function handleGetSettings(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = {
    registration_enabled: getSetting(REGISTRATION_KEY, "1") === "1",
  };
}

async function handleUpdateSettings(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const enabled = asOptionalBool(body.registration_enabled);
  if (enabled === undefined) {
    throw badRequest("registration_enabled (boolean) is required");
  }
  setSetting(REGISTRATION_KEY, enabled ? "1" : "0");
  logAudit(adminId, "settings.update", "setting", REGISTRATION_KEY);
  ctx.response.body = { registration_enabled: enabled };
}

function handleGetEmailSettings(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = { ...getEmailSettings() };
}

// Partial update of the SMTP/URL/confirmation settings. `smtp_password`
// accepts a string (new secret) or null (clear); unknown keys are ignored
// like the other settings routes.
async function handleUpdateEmailSettings(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case "smtp_host":
      case "smtp_user":
      case "smtp_from":
      case "app_base_url": {
        if (typeof value !== "string") throw badRequest(`${key} must be a string`);
        values[key] = value.trim();
        break;
      }
      case "smtp_port": {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw badRequest("smtp_port must be an integer between 1 and 65535");
        }
        values.smtp_port = String(port);
        break;
      }
      case "smtp_tls": {
        if (typeof value !== "string" || !isValidTlsMode(value)) {
          throw badRequest("smtp_tls must be one of: none, starttls, implicit");
        }
        values.smtp_tls = value;
        break;
      }
      case "smtp_password": {
        if (value === null) values.smtp_password = "";
        else if (typeof value === "string") values.smtp_password = value;
        else throw badRequest("smtp_password must be a string or null to clear");
        break;
      }
      case "email_confirmation_required": {
        if (typeof value !== "boolean") {
          throw badRequest("email_confirmation_required must be a boolean");
        }
        values.email_confirmation_required = value ? "1" : "0";
        break;
      }
      default:
        break;
    }
  }
  if (Object.keys(values).length === 0) {
    throw badRequest("No valid fields to update");
  }
  for (const [key, value] of Object.entries(values)) setEmailSetting(key, value);
  logAudit(adminId, "email.settings_update", "setting", Object.keys(values).join(","));
  ctx.response.body = { ...getEmailSettings() };
}

async function handleSendEmailTest(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!isMailAvailable()) {
    throw new AppError(
      ERROR_CODES.NETWORK_ERROR,
      "SMTP is not configured (smtp_host is empty)",
      { status: 503 },
    );
  }
  let result: MailResult;
  try {
    result = await sendMail({
      to: to || getUserById(adminId)!.email,
      subject: "CinemAItor mail test",
      text: "This is a test message from CinemAItor.\n\n" +
        "If you received it, your SMTP settings work.",
    });
  } catch (err) {
    if (err instanceof SmtpError) {
      throw new AppError(
        ERROR_CODES.NETWORK_ERROR,
        `Failed to send the test email via SMTP: ${err.message}`,
        { status: 503 },
      );
    }
    throw err;
  }
  logAudit(adminId, "email.test_sent", "email", result.transport);
  ctx.response.body = { sent: result.sent, transport: result.transport };
}

export const router = new Router()
  .get("/api/v1/users", authMiddleware, handleListUsers)
  .get("/api/v1/users/settings", authMiddleware, handleGetSettings)
  .patch("/api/v1/users/settings", authMiddleware, handleUpdateSettings)
  .get(
    "/api/v1/users/settings/email",
    authMiddleware,
    handleGetEmailSettings,
  )
  .patch(
    "/api/v1/users/settings/email",
    authMiddleware,
    handleUpdateEmailSettings,
  )
  .post(
    "/api/v1/users/settings/email/test",
    authMiddleware,
    handleSendEmailTest,
  )
  .post("/api/v1/users", authMiddleware, handleCreateUser)
  .patch("/api/v1/users/:id", authMiddleware, handleUpdateUser)
  .delete("/api/v1/users/:id", authMiddleware, handleDeleteUser);
