import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-encryption";

const MASTER = "master-secret-for-tests-0123456789abcdef";

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips plaintext", () => {
    const encrypted = encryptSecret(MASTER, "JBSWY3DPEHPK3PXP");
    expect(decryptSecret(MASTER, encrypted)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV per encryption", () => {
    const a = encryptSecret(MASTER, "same-secret");
    const b = encryptSecret(MASTER, "same-secret");
    expect(a).not.toEqual(b);
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptSecret(MASTER, "top-secret");
    expect(() => decryptSecret("wrong-master-key-0123456789abcdefgh", encrypted)).toThrow();
  });

  it("fails on tampered ciphertext (GCM auth)", () => {
    const encrypted = encryptSecret(MASTER, "top-secret");
    const parts = encrypted.split(".");
    const tamperedCt = Buffer.from(parts[1]!, "base64url");
    tamperedCt[0] = tamperedCt[0]! ^ 0xff;
    const tampered = [parts[0], tamperedCt.toString("base64url"), parts[2]].join(".");
    expect(() => decryptSecret(MASTER, tampered)).toThrow();
  });
});
