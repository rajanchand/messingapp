import { describe, expect, it } from "vitest";
import {
  deriveCsrfToken,
  generateOpaqueToken,
  hashToken,
  signExpiringValue,
  verifyCsrfToken,
  verifyExpiringValue,
} from "./tokens";

const SECRET = "test-session-secret-with-plenty-of-entropy-1234";

describe("opaque tokens", () => {
  it("generates unique, url-safe 256-bit tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
  });
});

describe("CSRF tokens", () => {
  it("verifies tokens derived from the same session", () => {
    const sessionHash = hashToken(generateOpaqueToken());
    const csrf = deriveCsrfToken(SECRET, sessionHash);
    expect(verifyCsrfToken(SECRET, sessionHash, csrf)).toBe(true);
  });

  it("rejects tokens from another session or secret", () => {
    const hashA = hashToken(generateOpaqueToken());
    const hashB = hashToken(generateOpaqueToken());
    const csrf = deriveCsrfToken(SECRET, hashA);
    expect(verifyCsrfToken(SECRET, hashB, csrf)).toBe(false);
    expect(verifyCsrfToken("another-secret-that-is-long-enough-000", hashA, csrf)).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(verifyCsrfToken(SECRET, hashToken("x"), "garbage")).toBe(false);
  });
});

describe("signed expiring values", () => {
  it("round-trips within the TTL", () => {
    const token = signExpiringValue(SECRET, "mfa:user-123", 60_000);
    const payload = verifyExpiringValue(SECRET, token);
    expect(payload?.value).toBe("mfa:user-123");
  });

  it("rejects expired values", () => {
    const token = signExpiringValue(SECRET, "mfa:user-123", -1);
    expect(verifyExpiringValue(SECRET, token)).toBeNull();
  });

  it("rejects tampered values", () => {
    const token = signExpiringValue(SECRET, "mfa:user-123", 60_000);
    const [value, exp, sig] = token.split(".");
    const forged = `${Buffer.from("mfa:attacker").toString("base64url")}.${exp}.${sig}`;
    expect(verifyExpiringValue(SECRET, forged)).toBeNull();
    expect(verifyExpiringValue(SECRET, `${value}.${Number(exp) + 10_000}.${sig}`)).toBeNull();
  });
});
