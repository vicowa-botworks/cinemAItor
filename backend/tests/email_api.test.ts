import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { clearCapturedMail, getCapturedMail } from "../src/services/mail.ts";

interface AuthBody {
  token: string;
  user: {
    id: number;
    email: string;
    display_name: string;
    role: string;
    must_change_password: boolean;
    email_confirmed: boolean;
  };
}

let baseUrl = "";

function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function bootstrap(
  email: string,
  password: string,
): Promise<AuthBody> {
  const res = await req("POST", "/api/v1/auth/bootstrap", {
    email,
    password,
    display_name: "Studio Owner",
  });
  assertEquals(res.status, 201);
  return (await res.json()) as AuthBody;
}

function tokenFrom(text: string): string {
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  assert(match, `no token found in mail body: ${text}`);
  return match[1]!;
}

describe("email flows api", () => {
  beforeEach(() => {
    freshMemoryDb();
    Deno.env.set("EMAIL_TRANSPORT", "mock");
    clearCapturedMail();
  });

  afterEach(() => {
    Deno.env.delete("EMAIL_TRANSPORT");
    clearCapturedMail();
    closeDb();
  });

  it("register without mail configured issues a token immediately", async () => {
    Deno.env.delete("EMAIL_TRANSPORT");
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");
        const res = await req("POST", "/api/auth/register", {
          email: "new@example.com",
          password: "password123",
          display_name: "New",
        });
        assertEquals(res.status, 201);
        const body = (await res.json()) as AuthBody;
        assert(body.token, "expected an immediate session token");
        assertEquals(body.user.email_confirmed, true);
      })();
    });
  });

  it("self-registration requires email confirmation when mail is available", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");

        const res = await req("POST", "/api/auth/register", {
          email: "new@example.com",
          password: "password123",
          display_name: "New",
        });
        assertEquals(res.status, 201);
        const body = (await res.json()) as {
          token?: string;
          message: string;
          user: { email_confirmed: boolean };
        };
        assertEquals(body.token, undefined);
        assertEquals(body.user.email_confirmed, false);

        // The account cannot sign in before confirmation.
        const denied = await req("POST", "/api/v1/auth/login", {
          email: "new@example.com",
          password: "password123",
        });
        assertEquals(denied.status, 403);
        assertEquals(
          ((await denied.json()) as { error: { code: string } }).error.code,
          "EMAIL_NOT_CONFIRMED",
        );

        // The confirmation link arrives by (mock) mail.
        const mail = getCapturedMail();
        assertEquals(mail.length, 1);
        assertEquals(mail[0]!.to, "new@example.com");
        const token = tokenFrom(mail[0]!.text);

        const confirm = await req(
          "POST",
          "/api/v1/auth/email-confirmation/confirm",
          { token },
        );
        assertEquals(confirm.status, 200);

        // Tokens are single-use.
        const reuse = await req(
          "POST",
          "/api/v1/auth/email-confirmation/confirm",
          { token },
        );
        assertEquals(reuse.status, 400);

        const login = await req("POST", "/api/v1/auth/login", {
          email: "new@example.com",
          password: "password123",
        });
        assertEquals(login.status, 200);
      })();
    });
  });

  it("resends a confirmation link and invalidates the previous one", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");
        await req("POST", "/api/auth/register", {
          email: "new@example.com",
          password: "password123",
          display_name: "New",
        });
        const oldToken = tokenFrom(getCapturedMail()[0]!.text);

        const resend = await req(
          "POST",
          "/api/v1/auth/email-confirmation/resend",
          { email: "new@example.com" },
        );
        assertEquals(resend.status, 202);
        assertEquals(getCapturedMail().length, 2);

        // The first link is no longer valid.
        const stale = await req(
          "POST",
          "/api/v1/auth/email-confirmation/confirm",
          { token: oldToken },
        );
        assertEquals(stale.status, 400);

        const newToken = tokenFrom(getCapturedMail()[1]!.text);
        const confirm = await req(
          "POST",
          "/api/v1/auth/email-confirmation/confirm",
          { token: newToken },
        );
        assertEquals(confirm.status, 200);
      })();
    });
  });

  it("resend never reveals whether an address is registered", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const res = await req(
          "POST",
          "/api/v1/auth/email-confirmation/resend",
          { email: "ghost@example.com" },
        );
        assertEquals(res.status, 202);
        assertEquals(getCapturedMail().length, 0);
      })();
    });
  });

  it("password reset: request, confirm with new password, old password dies", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");

        const requested = await req(
          "POST",
          "/api/v1/auth/password-reset/request",
          { email: "owner@example.com" },
        );
        assertEquals(requested.status, 202);
        const mail = getCapturedMail();
        assertEquals(mail.length, 1);
        assertEquals(mail[0]!.to, "owner@example.com");
        const token = tokenFrom(mail[0]!.text);

        const confirm = await req(
          "POST",
          "/api/v1/auth/password-reset/confirm",
          { token, new_password: "new-password-456" },
        );
        assertEquals(confirm.status, 200);

        const oldLogin = await req("POST", "/api/v1/auth/login", {
          email: "owner@example.com",
          password: "password123",
        });
        assertEquals(oldLogin.status, 401);

        const newLogin = await req("POST", "/api/v1/auth/login", {
          email: "owner@example.com",
          password: "new-password-456",
        });
        assertEquals(newLogin.status, 200);

        // The reset token cannot be reused.
        const reuse = await req(
          "POST",
          "/api/v1/auth/password-reset/confirm",
          { token, new_password: "another-password-1" },
        );
        assertEquals(reuse.status, 400);
      })();
    });
  });

  it("password reset recovers an account that never confirmed its email", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");
        await req("POST", "/api/auth/register", {
          email: "new@example.com",
          password: "password123",
          display_name: "New",
        });

        const requested = await req(
          "POST",
          "/api/v1/auth/password-reset/request",
          { email: "new@example.com" },
        );
        assertEquals(requested.status, 202);
        const mail = getCapturedMail();
        assertEquals(mail.length, 2); // confirmation + reset
        const token = tokenFrom(mail[1]!.text);

        const confirm = await req(
          "POST",
          "/api/v1/auth/password-reset/confirm",
          { token, new_password: "recovered-789" },
        );
        assertEquals(confirm.status, 200);

        // Using the reset link proves mailbox ownership, so the account is
        // confirmed and can sign in.
        const login = await req("POST", "/api/v1/auth/login", {
          email: "new@example.com",
          password: "recovered-789",
        });
        assertEquals(login.status, 200);
        assertEquals(
          ((await login.json()) as AuthBody).user.email_confirmed,
          true,
        );
      })();
    });
  });

  it("password reset request for an unknown address answers identically", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("owner@example.com", "password123");

        const known = await req(
          "POST",
          "/api/v1/auth/password-reset/request",
          { email: "owner@example.com" },
        );
        const unknown = await req(
          "POST",
          "/api/v1/auth/password-reset/request",
          { email: "ghost@example.com" },
        );
        assertEquals(known.status, 202);
        assertEquals(unknown.status, 202);
        assertEquals(
          (await unknown.clone().json()) as Record<string, unknown>,
          (await known.clone().json()) as Record<string, unknown>,
        );
        // Only the known address received a link.
        assertEquals(getCapturedMail().length, 1);
      })();
    });
  });

  it("reset and resend endpoints 503 when mail is unconfigured", async () => {
    Deno.env.delete("EMAIL_TRANSPORT");
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const reset = await req(
          "POST",
          "/api/v1/auth/password-reset/request",
          { email: "owner@example.com" },
        );
        assertEquals(reset.status, 503);
        const resend = await req(
          "POST",
          "/api/v1/auth/email-confirmation/resend",
          { email: "owner@example.com" },
        );
        assertEquals(resend.status, 503);
      })();
    });
  });

  it("admin can manage SMTP settings and send a test mail", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const getBefore = await req(
          "GET",
          "/api/v1/users/settings/email",
          undefined,
          admin.token,
        );
        assertEquals(getBefore.status, 200);
        const before = (await getBefore.json()) as Record<string, unknown>;
        assertEquals(before.smtp_host, "");
        assertEquals(before.smtp_password_set, false);
        assertEquals(before.email_confirmation_required, true);

        const patch = await req(
          "PATCH",
          "/api/v1/users/settings/email",
          {
            smtp_host: "mail.example.com",
            smtp_port: 2525,
            smtp_user: "mailer",
            smtp_password: "secret",
            smtp_from: "studio@example.com",
            smtp_tls: "implicit",
            email_confirmation_required: false,
          },
          admin.token,
        );
        assertEquals(patch.status, 200);
        const after = (await patch.json()) as Record<string, unknown>;
        assertEquals(after.smtp_host, "mail.example.com");
        assertEquals(after.smtp_port, 2525);
        assertEquals(after.smtp_tls, "implicit");
        assertEquals(after.smtp_password_set, true);
        assertEquals(after.email_confirmation_required, false);

        // Invalid values are rejected.
        const badPort = await req(
          "PATCH",
          "/api/v1/users/settings/email",
          { smtp_port: 70000 },
          admin.token,
        );
        assertEquals(badPort.status, 400);
        const badTls = await req(
          "PATCH",
          "/api/v1/users/settings/email",
          { smtp_tls: "maybe" },
          admin.token,
        );
        assertEquals(badTls.status, 400);

        // Test mail goes out through the (mock) transport.
        const test = await req(
          "POST",
          "/api/v1/users/settings/email/test",
          { to: "owner@example.com" },
          admin.token,
        );
        assertEquals(test.status, 200);
        const testBody = (await test.json()) as {
          sent: boolean;
          transport: string;
        };
        assertEquals(testBody.sent, true);
        const testMails = getCapturedMail();
        assertEquals(testMails.length, 1);
        assertEquals(testMails[0]!.to, "owner@example.com");

        // Clearing the password works.
        const cleared = await req(
          "PATCH",
          "/api/v1/users/settings/email",
          { smtp_password: null },
          admin.token,
        );
        assertEquals(cleared.status, 200);
        assertEquals(
          ((await cleared.json()) as Record<string, unknown>).smtp_password_set,
          false,
        );
      })();
    });
  });

  it("email settings endpoints are admin-only", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        const crew = await req(
          "POST",
          "/api/v1/users",
          {
            email: "crew@example.com",
            display_name: "Crew",
            password: "temp-pass-123",
          },
          admin.token,
        );
        assertEquals(crew.status, 201);
        const login = await req("POST", "/api/v1/auth/login", {
          email: "crew@example.com",
          password: "temp-pass-123",
        });
        assertEquals(login.status, 200);
        const token = ((await login.json()) as AuthBody).token;

        assertEquals(
          (await req("GET", "/api/v1/users/settings/email", undefined, token))
            .status,
          403,
        );
        assertEquals(
          (
            await req(
              "PATCH",
              "/api/v1/users/settings/email",
              { smtp_host: "x" },
              token,
            )
          ).status,
          403,
        );
      })();
    });
  });

  it("invitations: create via mail, accept, list, revoke", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const created = await req(
          "POST",
          "/api/v1/invitations",
          { email: "invitee@example.com", display_name: "Invitee" },
          admin.token,
        );
        assertEquals(created.status, 201);
        const createdBody = (await created.json()) as {
          invitation: { id: number; status: string; sent: boolean };
        };
        assertEquals(createdBody.invitation.status, "pending");
        assertEquals(createdBody.invitation.sent, true);

        const mail = getCapturedMail();
        assertEquals(mail.length, 1);
        assertEquals(mail[0]!.to, "invitee@example.com");
        const token = tokenFrom(mail[0]!.text);

        // Non-admins cannot list invitations.
        await req(
          "POST",
          "/api/v1/users",
          {
            email: "crew@example.com",
            display_name: "Crew",
            password: "temp-pass-123",
          },
          admin.token,
        );
        const crewLogin = await req("POST", "/api/v1/auth/login", {
          email: "crew@example.com",
          password: "temp-pass-123",
        });
        const crewToken = ((await crewLogin.json()) as AuthBody).token;
        assertEquals(
          (await req("GET", "/api/v1/invitations", undefined, crewToken))
            .status,
          403,
        );

        const listed = await req(
          "GET",
          "/api/v1/invitations",
          undefined,
          admin.token,
        );
        assertEquals(listed.status, 200);
        const listBody = (await listed.json()) as {
          invitations: {
            id: number;
            email: string;
            display_name: string | null;
            status: string;
            created_by_name: string | null;
          }[];
        };
        assertEquals(listBody.invitations.length, 1);
        assertEquals(listBody.invitations[0]!.email, "invitee@example.com");
        assertEquals(listBody.invitations[0]!.status, "pending");
        assertEquals(listBody.invitations[0]!.display_name, "Invitee");
        assertEquals(listBody.invitations[0]!.created_by_name, "Studio Owner");

        // Accepting creates a confirmed account and a session.
        const accepted = await req(
          "POST",
          "/api/v1/invitations/accept",
          { token, password: "chosen-pass-123" },
        );
        assertEquals(accepted.status, 201);
        const acceptedBody = (await accepted.json()) as AuthBody;
        assertEquals(acceptedBody.user.email, "invitee@example.com");
        assertEquals(acceptedBody.user.email_confirmed, true);
        assert(acceptedBody.token);

        const login = await req("POST", "/api/v1/auth/login", {
          email: "invitee@example.com",
          password: "chosen-pass-123",
        });
        assertEquals(login.status, 200);

        const listedAfter = await req(
          "GET",
          "/api/v1/invitations",
          undefined,
          admin.token,
        );
        const listAfter = (await listedAfter.json()) as {
          invitations: { status: string }[];
        };
        assertEquals(listAfter.invitations[0]!.status, "accepted");

        // Inviting again now conflicts: the account exists.
        const reinvite = await req(
          "POST",
          "/api/v1/invitations",
          { email: "invitee@example.com" },
          admin.token,
        );
        assertEquals(reinvite.status, 409);

        // Accepting an already-used token fails (the account exists now).
        const stale = await req(
          "POST",
          "/api/v1/invitations/accept",
          { token, password: "other-pass-456" },
        );
        assertEquals(stale.status, 409);
      })();
    });
  });

  it("invitations: re-invite reissues, revoke blocks acceptance", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const first = await req(
          "POST",
          "/api/v1/invitations",
          { email: "inv@example.com" },
          admin.token,
        );
        assertEquals(first.status, 201);
        const firstId = ((await first.json()) as {
          invitation: { id: number };
        }).invitation.id;
        const firstToken = tokenFrom(getCapturedMail()[0]!.text);

        // Re-inviting the same pending address revokes the old link.
        const second = await req(
          "POST",
          "/api/v1/invitations",
          { email: "inv@example.com" },
          admin.token,
        );
        assertEquals(second.status, 201);
        const secondId = ((await second.json()) as {
          invitation: { id: number };
        }).invitation.id;
        assert(secondId !== firstId);

        const listed = await req(
          "GET",
          "/api/v1/invitations",
          undefined,
          admin.token,
        );
        const rows = ((await listed.json()) as {
          invitations: { id: number; status: string }[];
        }).invitations;
        assertEquals(rows.length, 2);
        const statuses = new Map(rows.map((r) => [r.id, r.status]));
        assertEquals(statuses.get(firstId), "revoked");
        assertEquals(statuses.get(secondId), "pending");

        // The old link no longer works.
        const stale = await req(
          "POST",
          "/api/v1/invitations/accept",
          { token: firstToken, password: "chosen-pass-123" },
        );
        assertEquals(stale.status, 400);

        // Revoking the pending invitation blocks the fresh link.
        const revoke = await req(
          "DELETE",
          `/api/v1/invitations/${secondId}`,
          undefined,
          admin.token,
        );
        assertEquals(revoke.status, 204);
        const freshToken = tokenFrom(getCapturedMail()[1]!.text);
        const blocked = await req(
          "POST",
          "/api/v1/invitations/accept",
          { token: freshToken, password: "chosen-pass-123" },
        );
        assertEquals(blocked.status, 400);

        // Inviting an already-registered address conflicts.
        const dup = await req(
          "POST",
          "/api/v1/invitations",
          { email: "owner@example.com" },
          admin.token,
        );
        assertEquals(dup.status, 409);
        assertMatch(
          ((await dup.json()) as { error: { message: string } }).error
            .message,
          /already exists/i,
        );
      })();
    });
  });

  it("inviting without mail configured fails with 503", async () => {
    Deno.env.delete("EMAIL_TRANSPORT");
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        const res = await req(
          "POST",
          "/api/v1/invitations",
          { email: "inv@example.com" },
          admin.token,
        );
        assertEquals(res.status, 503);
      })();
    });
  });

  it("users list exposes email_confirmed and admin can confirm manually", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req("POST", "/api/auth/register", {
          email: "new@example.com",
          password: "password123",
          display_name: "New",
        });

        const list = await req("GET", "/api/v1/users", undefined, admin.token);
        const users = ((await list.json()) as {
          users: { id: number; email: string; email_confirmed: boolean }[];
        }).users;
        const fresh = users.find((u) => u.email === "new@example.com");
        assertEquals(fresh?.email_confirmed, false);
        assert(fresh, "user row with id expected");
        const idRow = fresh;

        const patch = await req(
          "PATCH",
          `/api/v1/users/${idRow.id}`,
          { email_confirmed: true },
          admin.token,
        );
        assertEquals(patch.status, 200);

        const login = await req("POST", "/api/v1/auth/login", {
          email: "new@example.com",
          password: "password123",
        });
        assertEquals(login.status, 200);
      })();
    });
  });
});
