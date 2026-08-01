import { encryptSecret } from "@zts/auth";
import { describe, expect, it } from "vitest";
import {
  decryptIntegrationSecrets,
  encryptIntegrationSecrets,
} from "./secrets";

describe("integration secrets", () => {
  const sessionSecret = "test-session-secret-with-enough-entropy-for-hkdf";

  it("round-trips credential blobs", () => {
    const secrets = {
      pat: "ghp_example_token",
      webhookUrl: "https://hooks.example.org/abc",
    };

    const encrypted = encryptIntegrationSecrets(sessionSecret, secrets);
    expect(encrypted).not.toContain("ghp_example_token");
    expect(encrypted).not.toContain("hooks.example.org");

    const decrypted = decryptIntegrationSecrets(sessionSecret, encrypted);
    expect(decrypted).toEqual(secrets);
  });

  it("rejects invalid decrypted payloads", () => {
    const encrypted = encryptSecret(sessionSecret, JSON.stringify([]));
    expect(() => decryptIntegrationSecrets(sessionSecret, encrypted)).toThrow(/Invalid integration secrets/);
  });
});

describe("redactLogMetadata", () => {
  it("redacts sensitive metadata keys", async () => {
    const { redactLogMetadata } = await import("./store");
    const redacted = redactLogMetadata({
      action: "send",
      webhookUrl: "https://hooks.example.org",
      nested: { apiToken: "secret-value", count: 1 },
    });

    expect(redacted).toEqual({
      action: "send",
      webhookUrl: "[REDACTED]",
      nested: { apiToken: "[REDACTED]", count: 1 },
    });
  });
});
