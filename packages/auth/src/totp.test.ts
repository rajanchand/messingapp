import { describe, expect, it } from "vitest";
import { generate } from "otplib";
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from "./totp";

describe("TOTP", () => {
  it("verifies a freshly generated code", async () => {
    const secret = generateTotpSecret();
    const code = await generate({ secret });
    await expect(verifyTotpCode(secret, code)).resolves.toBe(true);
  });

  it("rejects wrong codes", async () => {
    const secret = generateTotpSecret();
    const code = await generate({ secret });
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(verifyTotpCode(secret, wrong)).resolves.toBe(false);
  });

  it("rejects non-numeric input outright", async () => {
    const secret = generateTotpSecret();
    await expect(verifyTotpCode(secret, "abcdef")).resolves.toBe(false);
    await expect(verifyTotpCode(secret, "12345")).resolves.toBe(false);
  });

  it("builds a valid otpauth URL", () => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl("Zero Trust Security", "admin", secret);
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(encodeURIComponent("Zero Trust Security"));
    expect(url).toContain(secret);
  });
});
