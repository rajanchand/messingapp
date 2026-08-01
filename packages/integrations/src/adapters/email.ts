import type { HttpAdapterOptions } from "../types";
import { optionalString, requireString } from "./http";

export interface EmailSmtpConfig {
  host: string;
  port: number;
  from: string;
  secure: boolean;
  username?: string;
}

/**
 * SMTP email adapter stub. Validates configuration and simulates delivery
 * without opening network connections in this phase.
 */
export class EmailAdapter {
  readonly type = "email";

  private smtp: EmailSmtpConfig | undefined;

  constructor(_opts: HttpAdapterOptions = {}) {}

  async connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    const host = requireString(config.host, "host");
    const from = requireString(config.from, "from");
    const portRaw = config.port;
    const port =
      typeof portRaw === "number"
        ? portRaw
        : typeof portRaw === "string"
          ? Number.parseInt(portRaw, 10)
          : NaN;

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("port must be an integer between 1 and 65535");
    }

    const secure =
      config.secure === true ||
      config.secure === "true" ||
      (config.secure === undefined && port === 465);

    const username = optionalString(secrets.username ?? secrets.user);
    const password = optionalString(secrets.password);

    if (username && !password) {
      throw new Error("password is required when username is set");
    }

    this.smtp = { host, port, from, secure, username };
  }

  async disconnect(): Promise<void> {
    this.smtp = undefined;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();
    return {
      ok: true,
      message: `SMTP config valid for ${this.smtp!.host}:${this.smtp!.port} (stub; no connection attempted)`,
    };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const to = requireString(payload.to, "to");
    const subject = requireString(payload.subject, "subject");
    const _body = requireString(payload.body ?? payload.text, "body");

    void _body;
    void to;
    void subject;

    return {
      ok: true,
      message: `Email queued (stub) from ${this.smtp!.from}`,
    };
  }

  private ensureConnected(): void {
    if (!this.smtp) {
      throw new Error("Email adapter is not connected");
    }
  }
}
