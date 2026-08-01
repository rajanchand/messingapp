import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. TOTP seeds).
 * The data key is derived from SESSION_SECRET via HKDF with a fixed info
 * label, so rotating SESSION_SECRET invalidates stored MFA secrets - this is
 * documented in SECURITY.md.
 */
function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "zts-mfa-secret", "aes-256-gcm-key", 32));
}

export function encryptSecret(masterSecret: string, plaintext: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(masterSecret: string, encrypted: string): string {
  const [ivB64, ctB64, tagB64] = encrypted.split(".") as [string, string, string];
  const key = deriveKey(masterSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
