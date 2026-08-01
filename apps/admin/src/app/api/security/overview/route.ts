import { z } from "zod";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  getDb,
  loginAttempts,
  securityEvents,
  sessions,
  ipBlocks,
  ipAllowlist,
  adminUsers,
} from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const GET = createApiHandler(
  { permission: "security.read", querySchema, rateLimit: "api" },
  async ({ query }) => {
    const db = getDb();
    const since = new Date(Date.now() - query.days * 86_400_000);

    const [failedLogins, events, activeSessions, blocks, allowlist, lockouts] = await Promise.all([
      db
        .select()
        .from(loginAttempts)
        .where(and(eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since)))
        .orderBy(desc(loginAttempts.createdAt))
        .limit(100),
      db
        .select()
        .from(securityEvents)
        .where(gte(securityEvents.createdAt, since))
        .orderBy(desc(securityEvents.createdAt))
        .limit(100),
      db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          username: adminUsers.username,
          ip: sessions.ip,
          userAgent: sessions.userAgent,
          createdAt: sessions.createdAt,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(adminUsers, eq(sessions.userId, adminUsers.id))
        .where(and(isNull(sessions.revokedAt), gte(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.lastSeenAt))
        .limit(100),
      db.select().from(ipBlocks).orderBy(desc(ipBlocks.createdAt)).limit(100),
      db.select().from(ipAllowlist).orderBy(desc(ipAllowlist.createdAt)).limit(100),
      db
        .select({
          id: adminUsers.id,
          username: adminUsers.username,
          failedLoginCount: adminUsers.failedLoginCount,
          lockedUntil: adminUsers.lockedUntil,
        })
        .from(adminUsers)
        .where(
          or(
            gte(adminUsers.failedLoginCount, 1),
            sql`${adminUsers.lockedUntil} IS NOT NULL AND ${adminUsers.lockedUntil} > now()`,
          ),
        )
        .limit(50),
    ]);

    const suspiciousIps = Object.entries(
      failedLogins.reduce<Record<string, number>>((acc, row) => {
        if (!row.ip) return acc;
        acc[row.ip] = (acc[row.ip] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .filter(([, count]) => count >= 3)
      .map(([ip, count]) => ({ ip, failures: count }))
      .sort((a, b) => b.failures - a.failures);

    return jsonOk({
      failedLogins,
      events,
      sessions: activeSessions,
      ipBlocks: blocks,
      ipAllowlist: allowlist,
      lockouts,
      suspiciousIps,
    });
  },
);
