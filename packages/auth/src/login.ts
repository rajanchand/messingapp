import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@zts/database";
import {
  adminUsers,
  loginAttempts,
  mfaCredentials,
  recoveryCodes,
  securityEvents,
} from "@zts/database";
import { hashPassword, verifyPassword } from "./password";
import { decryptSecret } from "./secret-encryption";
import { hashToken } from "./tokens";
import { verifyTotpCode } from "./totp";
import { normalizeRecoveryCode } from "./recovery-codes";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/** Constant-shape dummy hash so unknown usernames take as long as bad passwords. */
const DUMMY_HASH_PROMISE: Promise<string> = hashPassword("dummy-password-for-timing");

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

export type LoginResult =
  | { status: "success"; user: typeof adminUsers.$inferSelect }
  | { status: "mfa_required"; user: typeof adminUsers.$inferSelect }
  | { status: "invalid" }
  | { status: "locked"; until: Date };

async function recordAttempt(
  db: Database,
  data: {
    username: string;
    userId?: string | null;
    success: boolean;
    reason?: string;
  },
  ctx: LoginContext,
) {
  await db.insert(loginAttempts).values({
    username: data.username,
    userId: data.userId ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    success: data.success,
    reason: data.reason ?? null,
  });
}

export async function loginWithPassword(
  db: Database,
  username: string,
  password: string,
  ctx: LoginContext,
): Promise<LoginResult> {
  const normalized = username.trim().toLowerCase();
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, normalized))
    .limit(1);
  const user = rows[0];

  if (!user) {
    // Burn comparable time to prevent username enumeration via timing.
    await verifyPassword(await DUMMY_HASH_PROMISE, password);
    await recordAttempt(db, { username: normalized, success: false, reason: "unknown_user" }, ctx);
    return { status: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAttempt(
      db,
      { username: normalized, userId: user.id, success: false, reason: "locked" },
      ctx,
    );
    return { status: "locked", until: user.lockedUntil };
  }

  if (!user.isActive) {
    await verifyPassword(await DUMMY_HASH_PROMISE, password);
    await recordAttempt(
      db,
      { username: normalized, userId: user.id, success: false, reason: "inactive" },
      ctx,
    );
    return { status: "invalid" };
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    const failedCount = user.failedLoginCount + 1;
    const lock = failedCount >= MAX_FAILED_LOGINS;
    await db
      .update(adminUsers)
      .set({
        failedLoginCount: failedCount,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(adminUsers.id, user.id));
    await recordAttempt(
      db,
      { username: normalized, userId: user.id, success: false, reason: "bad_password" },
      ctx,
    );
    if (lock) {
      await db.insert(securityEvents).values({
        type: "ACCOUNT_LOCKED",
        severity: "warning",
        userId: user.id,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { failedCount },
      });
    }
    return { status: "invalid" };
  }

  // Password OK - reset the failure counter.
  await db
    .update(adminUsers)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(adminUsers.id, user.id));

  if (user.mfaEnabled) {
    await recordAttempt(
      db,
      { username: normalized, userId: user.id, success: true, reason: "password_ok_mfa_pending" },
      ctx,
    );
    return { status: "mfa_required", user };
  }

  await finalizeSuccessfulLogin(db, user.id, normalized, ctx);
  return { status: "success", user };
}

async function finalizeSuccessfulLogin(
  db: Database,
  userId: string,
  username: string,
  ctx: LoginContext,
) {
  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(adminUsers.id, userId));
  await recordAttempt(db, { username, userId, success: true, reason: "login" }, ctx);
}

export type MfaVerifyResult = { ok: true; usedRecoveryCode: boolean } | { ok: false };

/**
 * Verifies a TOTP code or a recovery code for the second factor step.
 * `sessionSecret` is the platform SESSION_SECRET used to decrypt the stored
 * TOTP seed.
 */
export async function verifyMfaChallenge(
  db: Database,
  sessionSecret: string,
  userId: string,
  code: string,
  ctx: LoginContext,
): Promise<MfaVerifyResult> {
  const user = (
    await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1)
  )[0];
  if (!user || !user.isActive || !user.mfaEnabled) return { ok: false };

  const trimmed = code.trim();

  // 6-digit codes are TOTP; anything else is treated as a recovery code.
  if (/^\d{6}$/.test(trimmed)) {
    const cred = (
      await db.select().from(mfaCredentials).where(eq(mfaCredentials.userId, userId)).limit(1)
    )[0];
    if (!cred || !cred.verifiedAt) return { ok: false };
    const secret = decryptSecret(sessionSecret, cred.encryptedSecret);
    if (!(await verifyTotpCode(secret, trimmed))) {
      await recordAttempt(
        db,
        { username: user.username, userId, success: false, reason: "mfa_failed" },
        ctx,
      );
      return { ok: false };
    }
    await db
      .update(mfaCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(mfaCredentials.userId, userId));
    await finalizeSuccessfulLogin(db, userId, user.username, ctx);
    return { ok: true, usedRecoveryCode: false };
  }

  const codeHash = hashToken(normalizeRecoveryCode(trimmed));
  const matches = await db
    .select()
    .from(recoveryCodes)
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, codeHash),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .limit(1);
  const match = matches[0];
  if (!match) {
    await recordAttempt(
      db,
      { username: user.username, userId, success: false, reason: "recovery_code_failed" },
      ctx,
    );
    return { ok: false };
  }
  await db.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, match.id));
  await db.insert(securityEvents).values({
    type: "RECOVERY_CODE_USED",
    severity: "warning",
    userId,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });
  await finalizeSuccessfulLogin(db, userId, user.username, ctx);
  return { ok: true, usedRecoveryCode: true };
}

/** Re-authentication check used by sudo mode. Does not create sessions. */
export async function reauthenticate(
  db: Database,
  userId: string,
  password: string,
): Promise<boolean> {
  const user = (
    await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1)
  )[0];
  if (!user || !user.isActive) return false;
  return verifyPassword(user.passwordHash, password);
}
