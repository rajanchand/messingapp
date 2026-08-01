import { describe, expect, it, vi } from "vitest";
import { DiscordAdapter } from "./adapters/discord";
import { EmailAdapter } from "./adapters/email";
import { GitHubAdapter } from "./adapters/github";
import { SlackAdapter } from "./adapters/slack";
import { WebhookAdapter } from "./adapters/webhook";
import { IntegrationError } from "./errors";
import { getAdapter, listAdapterTypes } from "./registry";
import type { IntegrationAdapter } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("integration registry", () => {
  it("lists all supported adapter types", () => {
    expect(listAdapterTypes()).toEqual(["discord", "email", "github", "jira", "slack", "webhook"]);
  });

  it("returns a fresh adapter instance for each type", () => {
    for (const type of listAdapterTypes()) {
      const adapter = getAdapter(type);
      expect(adapter.type).toBe(type);
      expect(typeof adapter.connect).toBe("function");
      expect(typeof adapter.disconnect).toBe("function");
      expect(typeof adapter.test).toBe("function");
      expect(typeof adapter.send).toBe("function");
    }
  });

  it("throws IntegrationError for unknown adapter types", () => {
    expect(() => getAdapter("unknown")).toThrow(IntegrationError);
    expect(() => getAdapter("unknown")).toThrow(/Unknown integration adapter type/);
  });
});

describe("IntegrationAdapter contract", () => {
  const cases: Array<{
    type: string;
    connect: () => Promise<IntegrationAdapter>;
    sendPayload: Record<string, unknown>;
  }> = [
    {
      type: "email",
      connect: async () => {
        const adapter = new EmailAdapter();
        await adapter.connect(
          { host: "smtp.example.org", port: 587, from: "noreply@example.org" },
          {},
        );
        return adapter;
      },
      sendPayload: { to: "user@example.org", subject: "Hello", body: "Test" },
    },
    {
      type: "webhook",
      connect: async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
        const adapter = new WebhookAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
        await adapter.connect({ url: "https://hooks.example.org/inbound" }, { signingSecret: "test-secret" });
        return adapter;
      },
      sendPayload: { event: "user.created", data: { id: "1" } },
    },
    {
      type: "github",
      connect: async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ login: "octocat" }));
        const adapter = new GitHubAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
        await adapter.connect({ owner: "acme", repo: "platform" }, { pat: "ghp_test_token" });
        return adapter;
      },
      sendPayload: { title: "Bug", body: "Details" },
    },
    {
      type: "slack",
      connect: async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
        const adapter = new SlackAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
        await adapter.connect(
          { channel: "#alerts" },
          { webhookUrl: "https://hooks.slack.com/services/T/B/X" },
        );
        return adapter;
      },
      sendPayload: { text: "hello" },
    },
    {
      type: "discord",
      connect: async () => {
        const fetchFn = vi.fn(async () => jsonResponse({ id: "1" }));
        const adapter = new DiscordAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
        await adapter.connect(
          {},
          { webhookUrl: "https://discord.com/api/webhooks/1/token" },
        );
        return adapter;
      },
      sendPayload: { content: "hello" },
    },
  ];

  it.each(cases)("$type adapter supports connect, test, send, disconnect", async ({ connect, sendPayload }) => {
    const adapter = await connect();
    const testResult = await adapter.test();
    expect(testResult.ok).toBe(true);

    const sendResult = await adapter.send(sendPayload);
    expect(sendResult.ok).toBe(true);

    await adapter.disconnect();
    await expect(adapter.test()).rejects.toThrow(/not connected/);
  });
});
