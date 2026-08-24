import {
  createUser,
  deleteUserById,
  getUserByEmail,
  getUserById,
  setUserEmailConfirmed,
  setUserMustChangePassword,
  setUserPassword,
  type User,
} from "@cinemaItor/db/schema.ts";
import {
  createEmailToken,
  findEmailTokenByRawToken,
  markEmailTokenUsed,
  newRawToken,
  revokeUserEmailTokens,
} from "@cinemaItor/db/email_tokens.ts";
import {
  createInvitation,
  findInvitationByRawToken,
  findPendingInvitationByEmail,
  markInvitationAccepted,
  revokeInvitationById,
} from "@cinemaItor/db/invitations.ts";
import { badRequest, conflict } from "@cinemaItor/errors.ts";
import { getEmailSettings, type MailResult, sendMail } from "./mail.ts";
import { hashPassword } from "./password.ts";
import { revokeAllUserSessions } from "./sessions.ts";
import { logAudit } from "./audit.ts";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const EMAIL_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function baseUrl(): string {
  return getEmailSettings().app_base_url.replace(/\/+$/, "");
}

function expiresAt(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function sendPasswordResetEmail(
  email: string,
): Promise<MailResult> {
  const user = getUserByEmail(email);
  if (!user || !user.is_active) {
    // Never reveal whether an account exists.
    return { sent: false, transport: "disabled" };
  }
  const rawToken = newRawToken();
  revokeUserEmailTokens(user.id, "password_reset");
  // Awaited: the row must exist before the response goes out, or a follow-up
  // re-issue can revoke before this insert lands and leave the old token live.
  await createEmailToken(
    "password_reset",
    user.id,
    rawToken,
    expiresAt(PASSWORD_RESET_TTL_MS),
  );
  try {
    const result = await sendMail({
      to: user.email,
      subject: "Reset your CinemAItor password",
      text: [
        `Hi ${user.display_name},`,
        "",
        `A password reset was requested for your CinemAItor account (${user.email}).`,
        "",
        "Open this link to choose a new password:",
        `  ${baseUrl()}#/reset-password?token=${rawToken}`,
        "",
        "The link expires in 1 hour. If it does not work, request a new link.",
        "",
        "If you did not request this, ignore this email — your password stays unchanged.",
        "",
        "— CinemAItor",
      ].join("\n"),
    });
    if (!result.sent) revokeUserEmailTokens(user.id, "password_reset");
    return result;
  } catch (err) {
    revokeUserEmailTokens(user.id, "password_reset");
    throw err;
  }
}

export async function confirmPasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<User> {
  const token = await findEmailTokenByRawToken("password_reset", rawToken);
  if (!token) {
    throw badRequest("This password reset link is invalid or has expired");
  }
  const user = getUserById(token.user_id);
  if (!user || !user.is_active) {
    throw badRequest("This password reset link is invalid or has expired");
  }
  setUserPassword(user.id, await hashPassword(newPassword));
  setUserMustChangePassword(user.id, false);
  // Using the reset link proves mailbox ownership, so a self-registered
  // account that never opened its confirmation email can still recover.
  setUserEmailConfirmed(user.id, true);
  markEmailTokenUsed(token.id);
  revokeAllUserSessions(user.id);
  logAudit(user.id, "auth.password_reset", "user", String(user.id));
  return user;
}

// ---------------------------------------------------------------------------
// Email confirmation (self-registration)
// ---------------------------------------------------------------------------

export async function sendEmailConfirmationEmail(
  userId: number,
): Promise<MailResult> {
  const user = getUserById(userId);
  if (!user) throw new Error("User disappeared during confirmation email delivery");
  const rawToken = newRawToken();
  revokeUserEmailTokens(userId, "email_confirmation");
  // Awaited: the row must exist before the response goes out, or a follow-up
  // re-issue can revoke before this insert lands and leave the old token live.
  await createEmailToken(
    "email_confirmation",
    userId,
    rawToken,
    expiresAt(EMAIL_CONFIRMATION_TTL_MS),
  );
  try {
    const result = await sendMail({
      to: user.email,
      subject: "Confirm your CinemAItor email address",
      text: [
        `Hi ${user.display_name},`,
        "",
        `You registered a CinemAItor account with ${user.email}.`,
        "Open this link to confirm the address and activate your account:",
        `  ${baseUrl()}#/confirm-email?token=${rawToken}`,
        "",
        "The link expires in 24 hours.",
        "",
        "— CinemAItor",
      ].join("\n"),
    });
    if (!result.sent) revokeUserEmailTokens(userId, "email_confirmation");
    return result;
  } catch (err) {
    revokeUserEmailTokens(userId, "email_confirmation");
    throw err;
  }
}

export async function confirmEmailByToken(rawToken: string): Promise<User> {
  const token = await findEmailTokenByRawToken("email_confirmation", rawToken);
  if (!token) {
    throw badRequest("This confirmation link is invalid or has expired");
  }
  const user = getUserById(token.user_id);
  if (!user) {
    throw badRequest("This confirmation link is invalid or has expired");
  }
  setUserEmailConfirmed(user.id, true);
  markEmailTokenUsed(token.id);
  logAudit(user.id, "auth.email_confirmed", "user", String(user.id));
  return user;
}

export async function resendEmailConfirmation(
  email: string,
): Promise<MailResult> {
  const user = getUserByEmail(email);
  if (!user || !user.is_active || user.email_confirmed === 1) {
    // Never reveal whether an account exists.
    return { sent: false, transport: "disabled" };
  }
  return await sendEmailConfirmationEmail(user.id);
}

// Rolls back a registration that could not deliver its confirmation mail, so
// the user is not stranded in an unconfirmed state.
export function rollbackRegistration(userId: number): void {
  deleteUserById(userId);
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export interface SentInvitation {
  invitationId: number;
  email: string;
  result: MailResult;
}

export async function sendInvitation(
  admin: User,
  email: string,
  displayName: string | null,
): Promise<SentInvitation> {
  if (getUserByEmail(email)) {
    throw conflict("An account with this email already exists");
  }
  const rawToken = newRawToken();
  const invitationId = await createInvitation(
    email,
    rawToken,
    admin.id,
    expiresAt(INVITATION_TTL_MS),
    displayName,
  );
  logAudit(admin.id, "invitation.created", "invitation", email, { invitation_id: invitationId });
  try {
    const result = await sendMail({
      to: email,
      subject: "You are invited to join CinemAItor",
      text: [
        `Hi ${displayName ?? email.split("@")[0]},`,
        "",
        `${admin.display_name} invited you to join CinemAItor.`,
        "",
        "Open this link to create your account:",
        `  ${baseUrl()}#/invitation?token=${rawToken}`,
        "",
        "The link expires in 7 days.",
        "",
        "— CinemAItor",
      ].join("\n"),
    });
    if (!result.sent) revokeInvitationById(invitationId);
    return { invitationId, email, result };
  } catch (err) {
    revokeInvitationById(invitationId);
    throw err;
  }
}

export async function acceptInvitation(
  rawToken: string,
  newPassword: string,
  displayName: string,
): Promise<User> {
  const invitation = await findInvitationByRawToken(rawToken);
  if (!invitation) {
    throw badRequest("This invitation is invalid or has expired");
  }
  if (invitation.revoked_at) {
    throw badRequest("This invitation has been revoked");
  }
  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    throw badRequest("This invitation has expired");
  }
  if (getUserByEmail(invitation.email)) {
    throw conflict("An account with this email already exists");
  }
  const name = displayName || invitation.display_name || invitation.email.split("@")[0];
  // Invited users choose their own password and already proved mailbox
  // control by receiving the link, so the account starts confirmed.
  const userId = createUser(
    invitation.email,
    await hashPassword(newPassword),
    name,
    "user",
    false,
    true,
  );
  markInvitationAccepted(invitation.id);
  const user = getUserById(userId);
  if (!user) throw new Error("User disappeared after invitation acceptance");
  logAudit(user.id, "invitation.accepted", "invitation", invitation.email);
  return user;
}

export function hasPendingInvitation(email: string): boolean {
  return findPendingInvitationByEmail(email) !== undefined;
}
