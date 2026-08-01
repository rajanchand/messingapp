import { getDb } from "@zts/database";
import { revokeAllSessions } from "@zts/auth";
import { writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { clearSessionCookie } from "@/lib/api/cookies";

/** Logs out of every session, including the current one. */
export const POST = createApiHandler({}, async ({ auth, ip, userAgent }) => {
  const db = getDb();
  const count = await revokeAllSessions(db, auth.user.id);
  await writeSecurityEvent(db, {
    type: "ALL_SESSIONS_REVOKED",
    severity: "warning",
    userId: auth.user.id,
    ip,
    userAgent,
    metadata: { revokedCount: count },
  });
  const res = jsonOk({ status: "ok" as const, revokedCount: count });
  clearSessionCookie(res);
  return res;
});
