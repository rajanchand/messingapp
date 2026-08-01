import { describe, expect, it } from "vitest";
import { redactMetadata } from "./audit";

describe("audit metadata redaction", () => {
  it("redacts credential-like keys", () => {
    const result = redactMetadata({
      password: "hunter2",
      newPassword: "hunter3",
      accessToken: "syt_abc",
      apiSecret: "shh",
      cookie: "zts_session=...",
      authorization: "Bearer x",
      normalField: "keep-me",
    });
    expect(result.password).toBe("[REDACTED]");
    expect(result.newPassword).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.apiSecret).toBe("[REDACTED]");
    expect(result.cookie).toBe("[REDACTED]");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.normalField).toBe("keep-me");
  });

  it("redacts nested objects recursively", () => {
    const result = redactMetadata({
      request: { body: { password: "x" }, path: "/api/users" },
    });
    expect(result).toEqual({
      request: { body: { password: "[REDACTED]" }, path: "/api/users" },
    });
  });

  it("preserves arrays and primitives", () => {
    const result = redactMetadata({ roles: ["admin", "auditor"], count: 3, flag: true });
    expect(result).toEqual({ roles: ["admin", "auditor"], count: 3, flag: true });
  });
});
