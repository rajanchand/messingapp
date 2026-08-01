import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit opaque token, URL-safe. The raw value is only ever in the cookie. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the SHA-256 hash of a token is persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmacSign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * CSRF token derived from the session token hash (double-submit variant).
 * The token is handed to the client and must be echoed in a request header;
 * it is recomputable server-side, so no extra state is stored.
 */
export function deriveCsrfToken(sessionSecret: string, sessionTokenHash: string): string {
  return hmacSign(sessionSecret, `csrf:${sessionTokenHash}`);
}

export function verifyCsrfToken(
  sessionSecret: string,
  sessionTokenHash: string,
  provided: string,
): boolean {
  return safeEqual(deriveCsrfToken(sessionSecret, sessionTokenHash), provided);
}

export interface SignedPayload {
  value: string;
  expiresAt: number;
}

/** Creates a compact signed, expiring value (used for the MFA pending step). */
export function signExpiringValue(secret: string, value: string, ttlMs: number): string {
  const expiresAt = Date.now() + ttlMs;
  const body = `${Buffer.from(value).toString("base64url")}.${expiresAt}`;
  const sig = hmacSign(secret, body);
  return `${body}.${sig}`;
}

export function verifyExpiringValue(secret: string, token: string): SignedPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [valueB64, expStr, sig] = parts as [string, string, string];
  const body = `${valueB64}.${expStr}`;
  if (!safeEqual(hmacSign(secret, body), sig)) return null;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return { value: Buffer.from(valueB64, "base64url").toString(), expiresAt };
}
