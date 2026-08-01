import type { HttpAdapterOptions } from "../types";
import { httpRequest, optionalString, parseUrl, requireString } from "./http";

/** Discord integration via incoming webhook URL. */
export class DiscordAdapter {
  readonly type = "discord";

  private webhookUrl: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async connect(_config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    const webhookUrl = requireString(secrets.webhookUrl, "webhookUrl");
    parseUrl(webhookUrl, "webhookUrl");
    if (!webhookUrl.includes("discord.com/api/webhooks")) {
      throw new Error("webhookUrl must be a Discord webhook URL");
    }
    this.webhookUrl = webhookUrl;
  }

  async disconnect(): Promise<void> {
    this.webhookUrl = undefined;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();

    const response = await httpRequest(
      `${this.webhookUrl}?wait=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "ZTS integration test (safe to ignore)" }),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
    if (response.ok) {
      return { ok: true, message: "Discord webhook responded successfully" };
    }
    return { ok: false, message: `Discord webhook returned ${response.status}` };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const content = requireString(payload.content ?? payload.text ?? payload.message, "content");
    const username = optionalString(payload.username);

    const body: Record<string, string> = { content };
    if (username) body.username = username;

    const response = await httpRequest(
      this.webhookUrl!,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
    if (response.ok) return { ok: true };
    return { ok: false, message: `Discord webhook returned ${response.status}` };
  }

  private ensureConnected(): void {
    if (!this.webhookUrl) {
      throw new Error("Discord adapter is not connected");
    }
  }
}
