import * as argon2 from "argon2";

/**
 * OWASP-recommended Argon2id parameters (2024+): m=19MiB, t=2, p=1 as the
 * floor; we use slightly stronger settings since admin logins are rare.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/** Minimum policy for admin panel accounts. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters long.");
  if (password.length > 128) errors.push("Password must be at most 128 characters long.");
  if (!/[a-z]/.test(password)) errors.push("Password must contain a lowercase letter.");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain an uppercase letter.");
  if (!/[0-9]/.test(password)) errors.push("Password must contain a digit.");
  return { ok: errors.length === 0, errors };
}
