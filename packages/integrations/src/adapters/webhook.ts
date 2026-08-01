import type { HttpAdapterOptions, IntegrationAdapter } from "../types";
import {
  DEFAULT_SIGNATURE_HEADER,
  signPayload,
  verifyInboundSignature,
} from "../signing";
import { httpRequest, optionalString, parseUrl, requireString } from "./http";

/**
 * Generic outbound webhook with HMAC-SHA256 request signing.
 * Supports inbound verification via handleInbound.
 */
export class WebhookAdapter implements IntegrationAdapter {
  readonly type = "webhook";

  private targetUrl: string | undefined;
  private signingSecret: string | undefined;
  private signatureHeader: string = DEFAULT_SIGNATURE_HEADER;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    const targetUrl = requireString(config.url, "url");
    parseUrl(targetUrl, "url");

    this.targetUrl = targetUrl;
    this.signingSecret = requireString(secrets.signingSecret, "signingSecret");
    this.signatureHeader =
      optionalString(config.signatureHeader)?.toLowerCase() ?? DEFAULT_SIGNATURE_HEADER;
  }

  async disconnect(): Promise<void> {
    this.targetUrl = undefined;
    this.signingSecret = undefined;
    this.signatureHeader = DEFAULT_SIGNATURE_HEADER;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();

    const body = JSON.stringify({ event: "zts.integration.test", timestamp: Date.now() });
    const { header, value } = signPayload(this.signingSecret!, body, this.signatureHeader);

    const response = await httpRequest(
      this.targetUrl!,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [header]: value,
          "X-ZTS-Event": "integration.test",
        },
        body,
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );

    if (response.ok) {
      return { ok: true, message: "Webhook endpoint responded successfully" };
    }
    return { ok: false, message: `Webhook endpoint returned ${response.status}` };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const event = optionalString(payload.event) ?? "integration.event";
    const body = JSON.stringify({
      event,
      timestamp: Date.now(),
      data: payload.data ?? payload,
    });
    const { header, value } = signPayload(this.signingSecret!, body, this.signatureHeader);

    const response = await httpRequest(
      this.targetUrl!,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [header]: value,
          "X-ZTS-Event": event,
        },
        body,
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );

    if (response.ok) return { ok: true };
    return { ok: false, message: `Webhook endpoint returned ${response.status}` };
  }

  async handleInbound(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ handled: boolean; event?: string; data?: unknown }> {
    if (!this.signingSecret) {
      return { handled: false };
    }

    const rawBody = typeof body === "string" ? body : JSON.stringify(body ?? {});
    const valid = verifyInboundSignature(headers, rawBody, this.signingSecret, this.signatureHeader);
    if (!valid) {
      return { handled: false };
    }

    const event =
      headers["x-zts-event"] ??
      headers["X-ZTS-Event"] ??
      (typeof body === "object" && body !== null && "event" in body
        ? String((body as Record<string, unknown>).event)
        : undefined);

    return { handled: true, event, data: body };
  }

  private ensureConnected(): void {
    if (!this.targetUrl || !this.signingSecret) {
      throw new Error("Webhook adapter is not connected");
    }
  }
}
