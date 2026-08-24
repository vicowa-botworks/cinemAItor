# Email System

SMTP-based email for the account flows: **password reset**, **email confirmation on
self-registration**, and **admin invitations**. Email is fully optional — when no SMTP host is
configured the app degrades gracefully (see _Graceful degradation_ below).

## Configuration

Admins configure SMTP under `#/users` (the **Email (SMTP)** card). Settings are stored in the
`settings` table (`services/mail.ts`):

| Key                           | Meaning                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smtp_host`                   | SMTP server host. Empty string = email disabled.                                                                                                                                         |
| `smtp_port`                   | Port (1–65535, default 587).                                                                                                                                                             |
| `smtp_user`                   | AUTH LOGIN username.                                                                                                                                                                     |
| `smtp_password`               | AUTH LOGIN password. Stored in the settings table (never returned by the API — only a `smtp_password_set` flag). Set a new one by sending a non-empty value; clear it by sending `null`. |
| `smtp_from`                   | From header, e.g. `CinemAItor <noreply@example.com>`. Required once an SMTP host is set — sends fail with a `503` telling the admin to configure it.                                     |
| `smtp_tls`                    | `starttls` (port 587), `implicit` (TLS from connect, port 465), or `none` (local relay).                                                                                                 |
| `app_base_url`                | Base URL used in email links, e.g. `https://studio.example.com`. Falls back to `http://localhost:8124`.                                                                                  |
| `email_confirmation_required` | When `true` (default), self-registered accounts must open the confirmation link before their first login.                                                                                |

**Send test email** sends a plain-text test to the acting admin's own address (or an explicit `to`).
Without SMTP configured the test endpoint returns `503`.

## Endpoints

| Method | Endpoint                                  | Auth   | Description                                                                                                                 |
| ------ | ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/users/settings/email`            | admin  | Current settings (password as `smtp_password_set` flag only)                                                                |
| PATCH  | `/api/v1/users/settings/email`            | admin  | Update settings; any subset of the keys above (`smtp_password: null` clears)                                                |
| POST   | `/api/v1/users/settings/email/test`       | admin  | Send a test email; body `{to?}`                                                                                             |
| POST   | `/api/v1/auth/password-reset/request`     | public | Body `{email}` — `202` whether or not the address has an account (no enumeration); `503` when the instance cannot send mail |
| POST   | `/api/v1/auth/password-reset/confirm`     | public | Body `{token, new_password}` — sets the password, confirms the email, revokes every session of the account                  |
| POST   | `/api/v1/auth/email-confirmation/confirm` | public | Body `{token}` — marks the user's email confirmed                                                                           |
| POST   | `/api/v1/auth/email-confirmation/resend`  | public | Body `{email}` — `202` whether or not the address has an unconfirmed account; `503` when mail is unavailable                |
| GET    | `/api/v1/invitations`                     | admin  | Pending/accepted/revoked/expired invitations with status                                                                    |
| POST   | `/api/v1/invitations`                     | admin  | Body `{email, display_name?}` — issue (or reissue) an invitation                                                            |
| DELETE | `/api/v1/invitations/:id`                 | admin  | Revoke a pending invitation                                                                                                 |
| POST   | `/api/v1/invitations/accept`              | public | Body `{token, password, display_name?}` — create the account + a session                                                    |

All public endpoints are rate-limited like login/bootstrap.

## Flows

### Password reset

1. The user submits their email on the login page (**Forgot password?** → `#/forgot-password`).
2. The server looks up the user and — if found — issues a single-use `password_reset` token (1-hour
   TTL) and sends a link to `#/reset-password?token=…`. The response is always `202`, regardless of
   whether the account exists.
3. On `#/reset-password` the user sets a new password (min 8 chars). The confirm endpoint verifies
   the token, sets the new PBKDF2 hash, marks the email confirmed (receiving the reset link is proof
   of mailbox ownership — this also recovers an account that never opened its confirmation email),
   and **revokes all sessions** of the account (the old password can no longer be used to log in).

### Email confirmation (self-registration)

With `email_confirmation_required` on **and** SMTP configured:

1. `POST /api/auth/register` creates the user with `email_confirmed = 0`, issues a
   `email_confirmation` token (24-hour TTL), sends the link, and returns **`201` without a token**.
   The login form switches to a "check your inbox" state.
2. Login attempts with an unconfirmed account fail with `403` + error code `EMAIL_NOT_CONFIRMED`;
   the login form shows a **Resend confirmation email** button (`/email-confirmation/resend`).
3. Opening the link auto-confirms (`/email-confirmation/confirm`) and the user can sign in.

Admin-provisioned users (`POST /api/v1/users`) are created **confirmed** — the flow is reserved for
self-registration. Invited accounts (below) are also confirmed at accept time.

### Invitations (admin)

Invitations require a working mail transport — issuing one without SMTP configured fails with `503`
(there is no link to hand out otherwise).

1. An admin sends an invitation from `#/users` (**Invitations** card). A fresh `invitations` row is
   created (7-day TTL); re-inviting an address with a pending invitation reissues a fresh link (the
   old one is revoked). Inviting an address that already has an account fails with `409`. If the
   SMTP send itself fails, the invitation row is rolled back.
2. The invitee follows the link to `#/invitation?token=…`, chooses a display name and password, and
   the account is created **confirmed** with a live session in one step.
3. Pending invitations can be revoked (`DELETE /api/v1/invitations/:id`); accepting a revoked or
   expired token fails with `400`.

## Tokens

Single-use, random 32-byte tokens, stored SHA-256-hashed (raw value only ever in the email):

- `email_tokens` — kind `password_reset` (1 h) or `email_confirmation` (24 h), bound to a user, one
  active row per kind+user (issuing a new one revokes the previous).
- `invitations` — bound to an email address + creating admin, status derived from `accepted_at` /
  `revoked_at` / `expires_at`.

Consumption is single-use (the row is deleted or marked used/accepted on first use). Expiry is
checked at consumption time.

## SMTP client

`services/smtp.ts` is a minimal in-process client — no external mail dependency:

- Transport per the `smtp_tls` setting: `none` (plain, local relay), `starttls` (EHLO capability
  detection, then upgrade; the send fails if the server does not advertise `STARTTLS` — no silent
  plaintext), or `implicit` (TLS from the first byte, port-465 style).
- Auth: `AUTH LOGIN` (base64 challenge/response steps) when a user/password are set, falling back to
  `AUTH PLAIN` for servers that advertise only that; auth errors surface as `SmtpError`.
- MIME: single-part `text/plain`, 76-column soft-wrapping, `Content-Transfer-Encoding: 7bit`, RFC
  5321 dot-stuffing on the message body.
- Failures throw `SmtpError` (non-`2xx` replies, handshake timeouts, socket errors); the mail layer
  maps that to `503 NETWORK_ERROR` responses with the SMTP detail.

## Graceful degradation

Mail delivery is selected by `mailTransportName()`: **auto** (default) uses SMTP when `smtp_host` is
configured and is _disabled_ otherwise; the `EMAIL_TRANSPORT` env var forces `mock` (messages
captured in memory, retrievable via `getCapturedMail()` — used by the test suite and offline
development) or `smtp`.

With delivery **disabled** (the out-of-the-box state), the app behaves like it did before email
existed, so installs without an SMTP server keep working:

- Self-registration returns a session token immediately (the account is created confirmed) — the
  confirmation link flow only engages when mail can actually be delivered.
- Password-reset requests, confirmation resends, test emails, and invitations answer `503` with a
  clear "email delivery is not configured" message instead of pretending to send.
- Tokens are never stranded: flows roll back a freshly issued token when the send reports failure,
  and a registration whose confirmation mail cannot be delivered deletes the account rather than
  stranding it in an unconfirmed state.
