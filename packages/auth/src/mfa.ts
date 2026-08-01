import { eq } from "drizzle-orm";
import type { Database } from "@zts/database";
import { adminUsers, mfaCredentials, recoveryCodes, securityEvents } from "@zts/database";
import { encryptSecret, decryptSecret } from "./secret-encryption";
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from "./totp";
import { generateRecoveryCodes } from "./recovery-codes";

export interface TotpEnrollment {
  otpauthUrl: string;
  /** Base32 secret for manual entry. Shown once; never logged. */
  secret: string;
}

/** Creates (or replaces) an unverified TOTP credential for the user. */
export async function startTotpEnrollment(
  db: Database,
  sessionSecret: string,
  userId: string,
  appName: string,
  accountName: string,
): Promise<TotpEnrollment> {
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(sessionSecret, secret);
  await db
    .insert(mfaCredentials)
    .values({ userId, type: "totp", encryptedSecret: encrypted })
    .onConflictDoUpdate({
      target: mfaCredentials.userId,
      set: { encryptedSecret: encrypted, verifiedAt: null, createdAt: new Date() },
    });
  return { otpauthUrl: buildOtpauthUrl(appName, accountName, secret), secret };
}

export type TotpConfirmation = { ok: true; recoveryCodes: string[] } | { ok: false };

/**
 * Confirms enrollment with a valid code, enables MFA and issues recovery
 * codes (returned in plaintext exactly once).
 */
export async function confirmTotpEnrollment(
  db: Database,
  sessionSecret: string,
  userId: string,
  code: string,
): Promise<TotpConfirmation> {
  const cred = (
    await db.select().from(mfaCredentials).where(eq(mfaCredentials.userId, userId)).limit(1)
  )[0];
  if (!cred) return { ok: false };
  const secret = decryptSecret(sessionSecret, cred.encryptedSecret);
  if (!(await verifyTotpCode(secret, code.trim()))) return { ok: false };

  await db
    .update(mfaCredentials)
    .set({ verifiedAt: new Date() })
    .where(eq(mfaCredentials.userId, userId));
  await db
    .update(adminUsers)
    .set({ mfaEnabled: true, updatedAt: new Date() })
    .where(eq(adminUsers.id, userId));

  const generated = generateRecoveryCodes();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .insert(recoveryCodes)
    .values(generated.hashes.map((codeHash) => ({ userId, codeHash })));

  await db.insert(securityEvents).values({
    type: "MFA_ENABLED",
    severity: "info",
    userId,
  });

  return { ok: true, recoveryCodes: generated.codes };
}

export async function disableTotp(db: Database, userId: string): Promise<void> {
  await db.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .update(adminUsers)
    .set({ mfaEnabled: false, updatedAt: new Date() })
    .where(eq(adminUsers.id, userId));
  await db.insert(securityEvents).values({
    type: "MFA_DISABLED",
    severity: "warning",
    userId,
  });
}
