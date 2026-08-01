import { randomBytes } from "node:crypto";
import { hashToken } from "./tokens";

export const RECOVERY_CODE_COUNT = 10;

/** Format: xxxx-xxxx-xxxx (base32-ish, unambiguous alphabet). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export interface GeneratedRecoveryCodes {
  /** Plaintext codes - shown to the user exactly once. */
  codes: string[];
  /** SHA-256 hashes for storage. */
  hashes: string[];
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): GeneratedRecoveryCodes {
  const codes = Array.from({ length: count }, randomCode);
  return { codes, hashes: codes.map(hashToken) };
}

export function normalizeRecoveryCode(input: string): string {
  return input.trim().toLowerCase();
}
