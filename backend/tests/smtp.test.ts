import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import { SmtpClient, SmtpError } from "../src/services/smtp.ts";

interface FakeSmtp {
  port: number;
  transcript: string[];
  close: () => Promise<void>;
}

// A minimal in-process SMTP server. `ehloLines` are the continuation lines of
// the EHLO reply (the "250" status prefix is added by the server).
function startFakeSmtp(ehloLines: string[]): Promise<FakeSmtp> {
  const transcript: string[] = [];
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;

  const serverTask = (async () => {
    const conn = await listener.accept();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let pending = "";
    let awaiting = ""; // "username" | "password" | ""
    let dataMode = false;
    const write = (line: string) => conn.write(encoder.encode(`${line}\r\n`));

    await write("220 fake.example ESMTP ready");

    while (true) {
      const buf = new Uint8Array(4096);
      const n = await conn.read(buf);
      if (n === null) break;
      pending += decoder.decode(buf.subarray(0, n), { stream: true });
      let idx: number;
      while ((idx = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, idx).replace(/\r$/, "");
        pending = pending.slice(idx + 1);
        if (!line) continue;
        transcript.push(line);
        if (dataMode) {
          if (line === ".") {
            dataMode = false;
            await write("250 2.0.0 OK queued");
          }
          continue;
        }
        if (line.startsWith("EHLO")) {
          for (const [i, l] of ehloLines.entries()) {
            await write(`${i < ehloLines.length - 1 ? "250-" : "250 "}${l}`);
          }
        } else if (line.startsWith("AUTH LOGIN")) {
          await write("334 VXNlcm5hbWU6");
          awaiting = "username";
        } else if (awaiting === "username") {
          await write("334 UGFzc3dvcmQ6");
          awaiting = "password";
        } else if (awaiting === "password") {
          awaiting = "";
          await write("235 2.7.0 Authentication successful");
        } else if (line.startsWith("AUTH PLAIN")) {
          await write("235 2.7.0 Authentication successful");
        } else if (line.startsWith("MAIL FROM")) {
          await write("250 2.1.0 OK");
        } else if (line.startsWith("RCPT TO")) {
          await write("250 2.1.5 OK");
        } else if (line === "DATA") {
          await write("354 End data with <CR><LF>.<CR><LF>");
          dataMode = true;
        } else if (line === "QUIT") {
          await write("221 2.0.0 Bye");
          break;
        }
      }
    }
    try {
      conn.close();
    } catch {
      // Already closed.
    }
  })();

  void serverTask;
  return Promise.resolve({
    port,
    transcript,
    close: async () => {
      listener.close();
      await serverTask.catch(() => {});
    },
  });
}

describe("SmtpClient", () => {
  it("sends a message over plain SMTP with AUTH LOGIN", async () => {
    const server = await startFakeSmtp(["AUTH LOGIN PLAIN", "8BITMIME"]);
    const client = new SmtpClient({
      host: "127.0.0.1",
      port: server.port,
      tls: "none",
      username: "smtp-user",
      password: "smtp-pass",
      timeoutMs: 5000,
      ehloName: "testhost",
    });
    try {
      await client.connect();
      await client.send({
        from: "from@example.com",
        to: "to@example.com",
        subject: "Hello",
        text: "line one\n.dot-starting line\nlast line",
      });
    } finally {
      await client.close();
      await server.close();
    }

    const seen = server.transcript;
    assertEquals(seen[0], "EHLO testhost");
    assertEquals(seen[1], "AUTH LOGIN");
    assertEquals(seen[2], btoa("smtp-user"));
    assertEquals(seen[3], btoa("smtp-pass"));
    assertMatch(seen.join("\n"), /MAIL FROM:<from@example.com>/);
    assertMatch(seen.join("\n"), /RCPT TO:<to@example.com>/);
    // Dot-stuffing: a body line starting with a dot is escaped with an
    // extra dot, and the message ends with a lone dot.
    assertMatch(seen.join("\r\n"), /line one\r\n\.\.dot-starting line/);
    assertEquals(seen[seen.length - 2], ".");
    assertEquals(seen[seen.length - 1], "QUIT");
  });

  it("uses AUTH PLAIN when the server offers only PLAIN", async () => {
    const server = await startFakeSmtp(["AUTH=PLAIN"]);
    const client = new SmtpClient({
      host: "127.0.0.1",
      port: server.port,
      tls: "none",
      username: "u",
      password: "p",
      timeoutMs: 5000,
    });
    try {
      await client.connect();
      await client.send({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t",
      });
    } finally {
      await client.close();
      await server.close();
    }

    const authLine = server.transcript.find((l) => l.startsWith("AUTH PLAIN"));
    assertMatch(authLine ?? "", /^AUTH PLAIN [A-Za-z0-9+/=]+$/);
    assertEquals(
      atob((authLine ?? "").slice("AUTH PLAIN ".length)),
      "\0u\0p",
    );
  });

  it("skips authentication when no credentials are configured", async () => {
    const server = await startFakeSmtp(["8BITMIME"]);
    const client = new SmtpClient({
      host: "127.0.0.1",
      port: server.port,
      tls: "none",
      timeoutMs: 5000,
    });
    try {
      await client.connect();
      await client.send({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t",
      });
    } finally {
      await client.close();
      await server.close();
    }

    assertNotMatch(server.transcript.join("\n"), /AUTH/);
  });

  it("fails when STARTTLS is requested but not advertised", async () => {
    const server = await startFakeSmtp(["8BITMIME"]);
    const client = new SmtpClient({
      host: "127.0.0.1",
      port: server.port,
      tls: "starttls",
      timeoutMs: 5000,
    });
    await assertRejectsCompat(
      () => client.connect(),
      /does not advertise STARTTLS/,
    );
    await client.close();
    await server.close();
  });

  it("parses EHLO capability lines in both spellings", () => {
    const dash = SmtpClient.parseCapabilities([
      "250-localhost Hello",
      "250-SIZE 1024",
      "250-AUTH LOGIN PLAIN",
      "250 8BITMIME",
    ]);
    assertEquals(dash.has("SIZE"), true);
    assertEquals(dash.has("AUTH"), true);
    assertEquals(dash.has("AUTH LOGIN"), true);
    assertEquals(dash.has("AUTH PLAIN"), true);
    assertEquals(dash.has("8BITMIME"), true);

    const equals = SmtpClient.parseCapabilities([
      "250-AUTH=LOGIN,PLAIN",
      "250 STARTTLS",
    ]);
    assertEquals(equals.has("AUTH LOGIN"), true);
    assertEquals(equals.has("AUTH PLAIN"), true);
    assertEquals(equals.has("STARTTLS"), true);
  });
});

async function assertRejectsCompat(
  fn: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let failed = false;
  try {
    await fn();
  } catch (err) {
    failed = true;
    if (!(err instanceof SmtpError)) {
      throw new Error(`Expected SmtpError, got: ${String(err)}`);
    }
    if (!pattern.test(err.message)) {
      throw new Error(`SmtpError ${err.message} did not match ${pattern}`);
    }
  }
  if (!failed) throw new Error("Expected the promise to reject");
}
