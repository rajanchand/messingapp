import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "./recovery-codes";
import { hashToken } from "./tokens";

describe("recovery codes", () => {
  it("generates the expected number of unique codes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it("hashes correspond to the plaintext codes", () => {
    const { codes, hashes } = generateRecoveryCodes(3);
    codes.forEach((code, i) => {
      expect(hashToken(code)).toBe(hashes[i]);
    });
  });

  it("codes use the xxxx-xxxx-xxxx format", () => {
    const { codes } = generateRecoveryCodes(1);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it("normalizes user input", () => {
    expect(normalizeRecoveryCode("  ABcd-EFgh-IJkl ")).toBe("abcd-efgh-ijkl");
  });
});
