import type { HttpAdapterOptions } from "../types";
import { httpRequest, optionalString, parseUrl, requireString } from "./http";

type SlackMode = "webhook" | "bot";

/**
 * Slack integration via incoming webhook URL or bot token.
 * Credentials are held in memory only and never logged.
 */
export class SlackAdapter {
  readonly type = "slack";

  private mode: SlackMode | undefined;
  private webhookUrl: string | undefined;
  private botToken: string | undefined;
  private defaultChannel: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    this.defaultChannel = optionalString(config.channel);

    const webhookUrl = optionalString(secrets.webhookUrl);
    const botToken = optionalString(secrets.botToken);

    if (webhookUrl && botToken) {
      throw new Error("Provide either webhookUrl or botToken, not both");
    }
    if (!webhookUrl && !botToken) {
      throw new Error("Slack requires webhookUrl or botToken");
    }

    if (webhookUrl) {
      parseUrl(webhookUrl, "webhookUrl");
      if (!webhookUrl.includes("hooks.slack.com")) {
        throw new Error("webhookUrl must be a Slack incoming webhook URL");
      }
      this.mode = "webhook";
      this.webhookUrl = webhookUrl;
      this.botToken = undefined;
      return;
    }

    this.mode = "bot";
    this.botToken = requireString(botToken, "botToken");
    this.webhookUrl = undefined;
  }

  async disconnect(): Promise<void> {
    this.mode = undefined;
    this.webhookUrl = undefined;
    this.botToken = undefined;
    this.defaultChannel = undefined;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();

    if (this.mode === "webhook") {
      const response = await httpRequest(
        this.webhookUrl!,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "ZTS integration test (safe to ignore)" }),
        },
        { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
      );
      if (response.ok) {
        return { ok: true, message: "Slack webhook responded successfully" };
      }
      return { ok: false, message: `Slack webhook returned ${response.status}` };
    }

    const response = await httpRequest(
      "https://slack.com/api/auth.test",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
    const body = (await response.json()) as { ok?: boolean; error?: string; team?: string };
    if (response.ok && body.ok) {
      return { ok: true, message: `Slack bot connected to ${body.team ?? "workspace"}` };
    }
    return { ok: false, message: body.error ?? `Slack API returned ${response.status}` };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const text = requireString(payload.text ?? payload.message, "text");
    const channel = optionalString(payload.channel) ?? this.defaultChannel;

    if (this.mode === "webhook") {
      const response = await httpRequest(
        this.webhookUrl!,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
        { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
      );
      if (response.ok) return { ok: true };
      return { ok: false, message: `Slack webhook returned ${response.status}` };
    }

    const body: Record<string, string> = { text };
    if (channel) body.channel = channel;

    const response = await httpRequest(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
    const parsed = (await response.json()) as { ok?: boolean; error?: string };
    if (response.ok && parsed.ok) return { ok: true };
    return { ok: false, message: parsed.error ?? `Slack API returned ${response.status}` };
  }

  private ensureConnected(): void {
    if (!this.mode) {
      throw new Error("Slack adapter is not connected");
    }
  }
}
