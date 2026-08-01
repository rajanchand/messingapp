import { sql } from "drizzle-orm";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

/** Aggregated dashboard counters. All values come from live sources. */
export const GET = createApiHandler({ rateLimit: "api" }, async () => {
  const synapse = getSynapseClient();
  const db = getDb();

  const [activeUsers, allUsers, adminUsersCount, rooms, appStats] = await Promise.all([
    // Excludes deactivated accounts by default.
    synapse.listUsers({ limit: 1 }),
    synapse.listUsers({ limit: 1, deactivated: true }),
    synapse.listUsers({ limit: 1, admins: true }),
    synapse.listRooms({ limit: 1 }),
    db.execute(sql`
      select
        (select count(*) from sessions where revoked_at is null and expires_at > now()) as active_sessions,
        (select count(*) from login_attempts where success = false and created_at > now() - interval '24 hours') as failed_logins_24h,
        (select count(*) from security_events where created_at > now() - interval '24 hours') as security_events_24h,
        (select count(*) from admin_users where is_active = true) as panel_admins
    `),
  ]);

  const row = appStats[0] as
    | {
        active_sessions: string;
        failed_logins_24h: string;
        security_events_24h: string;
        panel_admins: string;
      }
    | undefined;

  return jsonOk({
    matrix: {
      activeUsers: activeUsers.total,
      totalUsers: allUsers.total,
      deactivatedUsers: Math.max(0, allUsers.total - activeUsers.total),
      serverAdmins: adminUsersCount.total,
      totalRooms: rooms.total_rooms,
    },
    panel: {
      activeSessions: Number(row?.active_sessions ?? 0),
      failedLogins24h: Number(row?.failed_logins_24h ?? 0),
      securityEvents24h: Number(row?.security_events_24h ?? 0),
      panelAdmins: Number(row?.panel_admins ?? 0),
    },
  });
});
