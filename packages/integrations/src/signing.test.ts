import { describe, expect, it } from "vitest";
import { signPayload, verifyInboundSignature } from "./signing";

const secret = "super-secret-signing-key";

describe("webhook signing", () => {
  const body = JSON.stringify({ event: "user.created", data: { id: "42" } });

  it("signs payloads with sha256 prefix", () => {
    const { header, value, digest } = signPayload(secret, body);
    expect(header).toBe("x-zts-signature");
    expect(value).toBe(`sha256=${digest}`);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies valid inbound signatures", () => {
    const { header, value } = signPayload(secret, body);
    const headers = { [header]: value, "x-zts-event": "user.created" };

    expect(verifyInboundSignature(headers, body, secret)).toBe(true);
  });

  it("rejects tampered bodies", () => {
    const { header, value } = signPayload(secret, body);
    const headers = { [header]: value };

    expect(verifyInboundSignature(headers, `${body}-tampered`, secret)).toBe(false);
  });

  it("rejects invalid or missing signatures", () => {
    expect(verifyInboundSignature({}, body, secret)).toBe(false);
    expect(verifyInboundSignature({ "x-zts-signature": "sha256=deadbeef" }, body, secret)).toBe(
      false,
    );
  });

  it("supports custom signature headers", () => {
    const customHeader = "x-custom-signature";
    const { header, value } = signPayload(secret, body, customHeader);
    expect(header).toBe(customHeader);
    expect(verifyInboundSignature({ [customHeader]: value }, body, secret, customHeader)).toBe(true);
  });
});

describe("WebhookAdapter handleInbound", () => {
  it("accepts signed inbound payloads", async () => {
    const { WebhookAdapter } = await import("./adapters/webhook");

    const adapter = new WebhookAdapter();
    await adapter.connect({ url: "https://hooks.example.org/out" }, { signingSecret: secret });

    const payload = { event: "order.placed", amount: 100 };
    const rawBody = JSON.stringify(payload);
    const { header, value } = signPayload(secret, rawBody);

    const result = await adapter.handleInbound(
      { [header]: value, "x-zts-event": "order.placed" },
      payload,
    );

    expect(result).toEqual({
      handled: true,
      event: "order.placed",
      data: payload,
    });

    await adapter.disconnect();
  });
});
