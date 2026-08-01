import { encryptSecret, decryptSecret } from "@zts/auth";

/** Encrypts integration credential blobs for storage in integration_secrets. */
export function encryptIntegrationSecrets(
  sessionSecret: string,
  secrets: Record<string, string>,
): string {
  return encryptSecret(sessionSecret, JSON.stringify(secrets));
}

/** Decrypts a credential blob from integration_secrets. */
export function decryptIntegrationSecrets(
  sessionSecret: string,
  encryptedBlob: string,
): Record<string, string> {
  const parsed = JSON.parse(decryptSecret(sessionSecret, encryptedBlob)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid integration secrets payload");
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

/** Reads SESSION_SECRET from the environment. */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return secret;
}

/** Convenience wrapper using SESSION_SECRET from the environment. */
export function encryptSecretsForStorage(secrets: Record<string, string>): string {
  return encryptIntegrationSecrets(getSessionSecret(), secrets);
}

/** Convenience wrapper using SESSION_SECRET from the environment. */
export function decryptSecretsFromStorage(encryptedBlob: string): Record<string, string> {
  return decryptIntegrationSecrets(getSessionSecret(), encryptedBlob);
}
