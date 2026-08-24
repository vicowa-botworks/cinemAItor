import { getSetting, setSetting } from "@cinemaItor/db/settings.ts";
import { AppError, ERROR_CODES } from "@cinemaItor/errors.ts";
import { createLogger } from "@cinemaItor/logger.ts";
import { SmtpClient, type SmtpTlsMode } from "./smtp.ts";

const logger = createLogger("info", { component: "mail" });

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type MailTransport = "smtp" | "mock" | "disabled";

export interface MailResult {
  sent: boolean;
  transport: MailTransport;
}

// Mail captured when EMAIL_TRANSPORT=mock (tests, offline dev).
const captured: MailMessage[] = [];

export function getCapturedMail(): MailMessage[] {
  return [...captured];
}

export function clearCapturedMail(): void {
  captured.length = 0;
}

// EMAIL_TRANSPORT: auto (default) uses SMTP when smtp_host is configured,
// otherwise mail delivery is disabled; "mock" captures mail in memory;
// "smtp" forces the SMTP transport.
export function mailTransportName(): MailTransport {
  const forced = (Deno.env.get("EMAIL_TRANSPORT") ?? "auto").toLowerCase();
  if (forced === "mock") return "mock";
  if (forced === "smtp") return "smtp";
  return getSetting("smtp_host", "").trim() ? "smtp" : "disabled";
}

export function isMailAvailable(): boolean {
  return mailTransportName() !== "disabled";
}

export interface EmailSettings {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_from: string;
  smtp_tls: SmtpTlsMode;
  app_base_url: string;
  smtp_password_set: boolean;
  email_confirmation_required: boolean;
}

const TLS_MODES: readonly SmtpTlsMode[] = ["none", "starttls", "implicit"];

export function emailSettingKeys(): string[] {
  return [
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_from",
    "smtp_tls",
    "app_base_url",
    "email_confirmation_required",
  ];
}

export function isValidTlsMode(value: string): boolean {
  return (TLS_MODES as readonly string[]).includes(value);
}

export function getEmailSettings(): EmailSettings {
  const tls = getSetting("smtp_tls", "starttls");
  return {
    smtp_host: getSetting("smtp_host", ""),
    smtp_port: Number.parseInt(getSetting("smtp_port", "587"), 10) || 587,
    smtp_user: getSetting("smtp_user", ""),
    smtp_from: getSetting("smtp_from", ""),
    smtp_tls: (TLS_MODES as readonly string[]).includes(tls) ? (tls as SmtpTlsMode) : "starttls",
    app_base_url: getSetting("app_base_url", "http://localhost:8124"),
    smtp_password_set: getSetting("smtp_password", "").length > 0,
    email_confirmation_required: getSetting("email_confirmation_required", "1") === "1",
  };
}

export function setEmailSetting(key: string, value: string): void {
  setSetting(key, value);
}

export async function sendMail(
  message: Omit<MailMessage, "from"> & { from?: string },
): Promise<MailResult> {
  const settings = getEmailSettings();
  const transport = mailTransportName();
  const mail: MailMessage = {
    from: message.from ?? settings.smtp_from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  };

  if (transport === "mock") {
    captured.push(mail);
    return { sent: true, transport: "mock" };
  }

  if (transport === "disabled") {
    logger.warn("Email delivery skipped: SMTP is not configured", {
      to: mail.to,
      subject: mail.subject,
    });
    return { sent: false, transport: "disabled" };
  }

  if (!mail.from) {
    throw new AppError(
      ERROR_CODES.NETWORK_ERROR,
      "SMTP is configured but no sender address (smtp_from) is set",
      { status: 503 },
    );
  }

  const client = new SmtpClient({
    host: settings.smtp_host,
    port: settings.smtp_port,
    tls: settings.smtp_tls,
    username: settings.smtp_user || undefined,
    password: getSetting("smtp_password", "") || undefined,
  });
  try {
    await client.connect();
    await client.send(mail);
  } finally {
    await client.close();
  }
  return { sent: true, transport: "smtp" };
}
