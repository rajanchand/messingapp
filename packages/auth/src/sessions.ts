import { and, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "@zts/database";
import { adminUsers, sessions } from "@zts/database";
import { generateOpaqueToken, hashToken } from "./tokens";

/** Absolute session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Idle timeout - sessions unused for longer than this are rejected. */
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
/** How long sudo mode (recent re-authentication) lasts. */
export const SUDO_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** Throttle lastSeenAt writes. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  /** Raw token for the HttpOnly cookie. Never persisted or logged. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: string,
  ctx: SessionContext,
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const inserted = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: inserted[0]!.id, expiresAt };
}

export type ValidSession = {
  session: typeof sessions.$inferSelect;
  user: typeof adminUsers.$inferSelect;
};

/**
 * Validates a raw session token: existence, revocation, absolute expiry,
 * idle timeout and that the account is still active.
 */
export async function validateSessionToken(
  db: Database,
  token: string,
): Promise<ValidSession | null> {
  const tokenHash = hashToken(token);
  const rows = await db
    .select({ session: sessions, user: adminUsers })
    .from(sessions)
    .innerJoin(adminUsers, eq(sessions.userId, adminUsers.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  const { session, user } = row;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < now) return null;
  if (session.lastSeenAt.getTime() + SESSION_IDLE_TIMEOUT_MS < now) return null;
  if (!user.isActive) return null;

  if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, session.id));
  }
  return row;
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(
  db: Database,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
  const updated = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: sessions.id });
  return updated.length;
}

export async function listActiveSessions(db: Database, userId: string) {
  return db
    .select({
      id: sessions.id,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Marks a session as being in sudo mode after successful re-authentication. */
export async function enterSudoMode(db: Database, sessionId: string): Promise<Date> {
  const sudoUntil = new Date(Date.now() + SUDO_TTL_MS);
  await db.update(sessions).set({ sudoUntil }).where(eq(sessions.id, sessionId));
  return sudoUntil;
}

export function isSudoActive(session: { sudoUntil: Date | null }): boolean {
  return !!session.sudoUntil && session.sudoUntil.getTime() > Date.now();
}
