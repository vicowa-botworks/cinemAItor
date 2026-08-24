// Minimal SMTP client over Deno TCP/TLS sockets (no dependencies).
// Supports: plain, STARTTLS upgrade, and implicit TLS (port 465 style),
// AUTH LOGIN / AUTH PLAIN, single-recipient text mail with dot-stuffing.

export type SmtpTlsMode = "none" | "starttls" | "implicit";

export interface SmtpClientOptions {
  host: string;
  port: number;
  tls: SmtpTlsMode;
  username?: string;
  password?: string;
  /** Per-socket-operation timeout in ms (default 30 s). */
  timeoutMs?: number;
  /** Name advertised in EHLO (default "localhost"). */
  ehloName?: string;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export class SmtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpError";
  }
}

function b64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export class SmtpClient {
  #options: SmtpClientOptions;
  #conn: Deno.Conn | null = null;
  #decoder = new TextDecoder();
  #pending = "";
  #capabilities = new Set<string>();

  constructor(options: SmtpClientOptions) {
    this.#options = options;
  }

  async connect(): Promise<void> {
    const { host, port, tls } = this.#options;
    let conn: Deno.TcpConn | Deno.TlsConn;
    if (tls === "implicit") {
      conn = await this.#guardTimeout(
        Deno.connectTls({ hostname: host, port, alpnProtocols: ["smtp"] }),
        "connecting",
      );
    } else {
      conn = await this.#guardTimeout(
        Deno.connect({ hostname: host, port }),
        "connecting",
      );
    }
    this.#conn = conn;
    await this.#readResponse("220");
    await this.#ehlo();

    if (tls === "starttls") {
      if (!this.#capabilities.has("STARTTLS")) {
        throw new SmtpError("SMTP server does not advertise STARTTLS");
      }
      await this.#writeLine("STARTTLS");
      await this.#readResponse("220");
      // Safe cast: at this point the socket is still the plain TCP one.
      const upgraded = await this.#guardTimeout(
        Deno.startTls(conn as Deno.TcpConn, { hostname: host }),
        "upgrading to TLS",
      );
      conn = upgraded;
      this.#conn = conn;
      await this.#ehlo();
    }

    const { username, password } = this.#options;
    if (username !== undefined && username !== "") {
      if (!this.#capabilities.has("AUTH")) {
        throw new SmtpError("SMTP server does not advertise AUTH");
      }
      if (this.#capabilities.has("AUTH LOGIN")) {
        await this.#authLogin(username, password ?? "");
      } else if (this.#capabilities.has("AUTH PLAIN")) {
        await this.#authPlain(username, password ?? "");
      } else {
        throw new SmtpError(
          "SMTP server supports neither AUTH LOGIN nor AUTH PLAIN",
        );
      }
    }
  }

  async send(message: SmtpMessage): Promise<void> {
    if (!this.#conn) throw new SmtpError("Not connected");
    await this.#writeLine(`MAIL FROM:<${message.from}>`);
    await this.#readResponse("250");
    await this.#writeLine(`RCPT TO:<${message.to}>`);
    await this.#readResponse("250");
    await this.#writeLine("DATA");
    await this.#readResponse("354");
    await this.#writeAll(new TextEncoder().encode(this.#formatMessage(message)));
    await this.#readResponse("250");
  }

  async close(): Promise<void> {
    const conn = this.#conn;
    this.#conn = null;
    this.#capabilities = new Set();
    if (!conn) return;
    try {
      const quit = (async () => {
        await conn.write(new TextEncoder().encode("QUIT\r\n"));
      })();
      await Promise.race([
        quit,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Best effort: the socket close below is what matters.
    }
    try {
      conn.close();
    } catch {
      // Already closed.
    }
  }

  #formatMessage(message: SmtpMessage): string {
    const headers = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
    ];
    // Dot-stuffing: lines starting with a dot get an extra dot prepended;
    // the message ends with a line containing a single dot.
    const body = message.text
      .split("\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    return [...headers, body, "."].join("\r\n") + "\r\n";
  }

  async #ehlo(): Promise<void> {
    const name = this.#options.ehloName ?? "localhost";
    await this.#writeLine(`EHLO ${name}`);
    const lines = await this.#readResponse("250");
    this.#capabilities = SmtpClient.parseCapabilities(lines);
  }

  // Parses EHLO response lines into a capability set. The AUTH line arrives
  // either as "250-host AUTH LOGIN PLAIN" or "250-host AUTH=LOGIN,PLAIN";
  // both are normalized to "AUTH" + "AUTH <MECH>" entries.
  static parseCapabilities(lines: string[]): Set<string> {
    const caps = new Set<string>();
    for (const line of lines) {
      const text = line.slice(4).trim().toUpperCase();
      if (!text) continue;
      const auth = text.match(/^AUTH[= ](.+)$/);
      if (auth) {
        caps.add("AUTH");
        for (const mech of auth[1].split(/[ ,]+/)) {
          if (mech) caps.add(`AUTH ${mech}`);
        }
      } else {
        caps.add(text.split(" ")[0]);
      }
    }
    return caps;
  }

  async #authLogin(username: string, password: string): Promise<void> {
    await this.#writeLine("AUTH LOGIN");
    await this.#readResponse("334");
    await this.#writeLine(b64(username));
    await this.#readResponse("334");
    await this.#writeLine(b64(password));
    await this.#readResponse("235");
  }

  async #authPlain(username: string, password: string): Promise<void> {
    const initialResponse = b64(`\0${username}\0${password}`);
    await this.#writeLine(`AUTH PLAIN ${initialResponse}`);
    await this.#readResponse("235");
  }

  // Returns all lines of the (possibly multi-line) response; throws when the
  // final line does not carry the expected status code.
  async #readResponse(expected: string): Promise<string[]> {
    const lines: string[] = [];
    while (true) {
      const line = await this.#readLine();
      lines.push(line);
      if (line.length < 4) {
        throw new SmtpError(`Malformed SMTP response: ${JSON.stringify(line)}`);
      }
      if (line[3] === " ") {
        const code = line.slice(0, 3);
        if (code !== expected) {
          throw new SmtpError(
            `Unexpected SMTP response (expected ${expected}): ${line}`,
          );
        }
        return lines;
      }
    }
  }

  async #readLine(): Promise<string> {
    while (!this.#pending.includes("\n")) {
      const buf = new Uint8Array(4096);
      const n = await this.#guardTimeout(
        this.#conn!.read(buf),
        "waiting for an SMTP response",
      );
      if (n === null) throw new SmtpError("SMTP connection closed unexpectedly");
      this.#pending += this.#decoder.decode(buf.subarray(0, n), { stream: true });
    }
    const idx = this.#pending.indexOf("\n");
    const line = this.#pending.slice(0, idx);
    this.#pending = this.#pending.slice(idx + 1);
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }

  async #writeLine(line: string): Promise<void> {
    await this.#writeAll(new TextEncoder().encode(`${line}\r\n`));
  }

  async #writeAll(data: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < data.length) {
      const written = await this.#guardTimeout(
        this.#conn!.write(data.subarray(offset)),
        "writing to the SMTP server",
      );
      offset += written;
    }
  }

  async #guardTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
    const ms = this.#options.timeoutMs ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SmtpError(`Timeout while ${what}`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
