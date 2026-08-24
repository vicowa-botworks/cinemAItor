import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  findPendingInvitationByEmail,
  getInvitationById,
  type Invitation,
  type InvitationWithCreator,
  listInvitations,
  revokeInvitationById,
} from "@cinemaItor/db/invitations.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { authRateLimitMiddleware } from "@cinemaItor/middleware/rate_limit.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import { acceptInvitation, sendInvitation } from "@cinemaItor/services/email_flows.ts";
import { isMailAvailable } from "@cinemaItor/services/mail.ts";
import { issueSession } from "@cinemaItor/services/sessions.ts";
import { SmtpError } from "@cinemaItor/services/smtp.ts";
import {
  AppError,
  badRequest,
  ERROR_CODES,
  forbidden,
  notFound,
  unauthorized,
} from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function mailNotConfiguredError(): never {
  throw new AppError(
    ERROR_CODES.NETWORK_ERROR,
    "Email delivery is not configured on this server (SMTP settings are missing)",
    { status: 503 },
  );
}

type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

function invitationStatus(invitation: Invitation): InvitationStatus {
  if (invitation.revoked_at) return "revoked";
  if (invitation.accepted_at) return "accepted";
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return "expired";
  return "pending";
}

function invitationShape(invitation: InvitationWithCreator) {
  return {
    id: invitation.id,
    email: invitation.email,
    display_name: invitation.display_name,
    created_by_name: invitation.created_by_name,
    created_at: invitation.created_at,
    expires_at: invitation.expires_at,
    status: invitationStatus(invitation),
  };
}

function handleListInvitations(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = {
    invitations: listInvitations().map(invitationShape),
  };
}

async function handleCreateInvitation(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) {
    throw badRequest("A valid email is required");
  }
  let displayName: string | null = null;
  if (body.display_name !== undefined && body.display_name !== null) {
    if (typeof body.display_name !== "string") {
      throw badRequest("display_name must be a string");
    }
    displayName = body.display_name.trim() || null;
    if (displayName && displayName.length > 100) {
      throw badRequest("Display name must be at most 100 characters");
    }
  }
  if (!isMailAvailable()) mailNotConfiguredError();

  // Re-inviting an address with a pending invitation reissues a fresh link.
  const pending = findPendingInvitationByEmail(email);
  if (pending) revokeInvitationById(pending.id);

  let sent;
  try {
    sent = await sendInvitation(getUserById(adminId)!, email, displayName);
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof SmtpError) {
      throw new AppError(
        ERROR_CODES.NETWORK_ERROR,
        `Failed to send the invitation email via SMTP: ${err.message}`,
        { status: 503 },
      );
    }
    throw err;
  }
  ctx.response.status = 201;
  ctx.response.body = {
    invitation: {
      id: sent.invitationId,
      email,
      display_name: displayName,
      status: "pending",
      sent: sent.result.sent,
      transport: sent.result.transport,
    },
  };
}

function handleRevokeInvitation(ctx: ParamContext): void {
  const adminId = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid invitation id");
  const invitation = getInvitationById(id);
  if (!invitation) throw notFound("Invitation not found");
  if (!revokeInvitationById(id)) {
    throw badRequest("Only pending invitations can be revoked");
  }
  logAudit(adminId, "invitation.revoked", "invitation", invitation.email);
  ctx.response.status = 204;
}

// Public: the invitee follows the link from their email and chooses a
// password. Creates a confirmed account and a session in one step.
async function handleAcceptInvitation(ctx: Context): Promise<void> {
  const body = await readJsonBody(ctx);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) throw badRequest("An invitation token is required");
  if (typeof body.password !== "string") throw badRequest("password is required");
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  let displayName = "";
  if (body.display_name !== undefined && body.display_name !== null) {
    if (typeof body.display_name !== "string") {
      throw badRequest("display_name must be a string");
    }
    displayName = body.display_name.trim();
    if (displayName.length > 100) {
      throw badRequest("Display name must be at most 100 characters");
    }
  }

  const user = await acceptInvitation(token, body.password, displayName);
  const fresh = getUserById(user.id);
  if (!fresh) throw notFound("User not found");
  const sessionToken = await issueSession(fresh.id);
  ctx.response.status = 201;
  ctx.response.body = {
    token: sessionToken,
    user: {
      id: fresh.id,
      email: fresh.email,
      display_name: fresh.display_name,
      role: fresh.role,
      must_change_password: false,
      email_confirmed: true,
    },
  };
}

export const router = new Router()
  .get("/api/v1/invitations", authMiddleware, handleListInvitations)
  .post("/api/v1/invitations", authMiddleware, handleCreateInvitation)
  .delete("/api/v1/invitations/:id", authMiddleware, handleRevokeInvitation)
  .post(
    "/api/v1/invitations/accept",
    authRateLimitMiddleware,
    handleAcceptInvitation,
  );

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/invitations": {
    summary: "List all invitations",
    description: "Status is derived: 'revoked' > 'accepted' > 'expired' (past " +
      "expires_at) > 'pending'.",
    adminOnly: true,
    responses: {
      200: {
        description: "All invitations",
        schema: {
          type: "object",
          required: ["invitations"],
          properties: {
            invitations: { type: "array", items: ref("Invitation") },
          },
        },
      },
      ...errorResponses(401, 403),
    },
  },
  "POST /api/v1/invitations": {
    summary: "Send an invitation email",
    description: "Issues a 7-day single-use link and emails it. Re-inviting an " +
      "address with a pending invitation reissues a fresh link. 503 when " +
      "SMTP is not configured.",
    adminOnly: true,
    requestBody: { schema: ref("InvitationCreateRequest") },
    responses: {
      201: {
        description: "The invitation and delivery result",
        schema: {
          type: "object",
          required: ["invitation"],
          properties: {
            invitation: { $ref: "#/components/schemas/InvitationCreated" },
          },
        },
      },
      ...errorResponses(400, 401, 403, 409, 503),
    },
  },
  "DELETE /api/v1/invitations/{id}": {
    summary: "Revoke a pending invitation",
    adminOnly: true,
    responses: {
      204: { description: "Invitation revoked" },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/invitations/accept": {
    summary: "Accept an invitation (public link flow)",
    description: "The invitee follows the link from the email and chooses a " +
      "password. Creates a confirmed account and a session in one step. " +
      "Tokens are single-use: an already-used, revoked, or expired " +
      "invitation is rejected, and an existing account conflicts.",
    requestBody: { schema: ref("InvitationAcceptRequest") },
    responses: {
      201: {
        description: "Session token and the created user",
        schema: ref("SessionIssued"),
      },
      ...errorResponses(400, 409, 429),
    },
  },
};
