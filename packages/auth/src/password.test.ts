import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes with argon2id and verifies correct passwords", async () => {
    const hash = await hashPassword("correct horse Battery 9 staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct horse Battery 9 staple")).resolves.toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const hash = await hashPassword("correct horse Battery 9 staple");
    await expect(verifyPassword(hash, "wrong password 123 A")).resolves.toBe(false);
  });

  it("never verifies against malformed hashes", async () => {
    await expect(verifyPassword("not-a-hash", "whatever")).resolves.toBe(false);
  });

  it("produces unique salts per hash", async () => {
    const [a, b] = await Promise.all([hashPassword("Same Password 123"), hashPassword("Same Password 123")]);
    expect(a).not.toEqual(b);
  });
});

describe("password policy", () => {
  it("accepts strong passwords", () => {
    expect(checkPasswordPolicy("Str0ng and long enough").ok).toBe(true);
  });

  it("rejects short passwords", () => {
    const result = checkPasswordPolicy("Sh0rt");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/12 characters/);
  });

  it("requires character variety", () => {
    expect(checkPasswordPolicy("alllowercaseonly").ok).toBe(false);
    expect(checkPasswordPolicy("ALLUPPERCASEONLY").ok).toBe(false);
    expect(checkPasswordPolicy("NoDigitsHereAtAll").ok).toBe(false);
  });
});
