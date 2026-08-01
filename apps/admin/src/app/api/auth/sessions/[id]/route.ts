import { eq } from "drizzle-orm";
import { getDb, sessions } from "@zts/database";
import { revokeSession } from "@zts/auth";
import { writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { clearSessionCookie } from "@/lib/api/cookies";

/** Revokes one of the caller's own sessions. */
export const DELETE = createApiHandler({}, async ({ auth, params, ip, userAgent }) => {
  const sessionId = params.id;
  if (!sessionId) return jsonError(400, "validation", "Session id is required.");

  const db = getDb();
  const target = (
    await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  )[0];
  // Only the owner may revoke; do not reveal other users' session ids.
  if (!target || target.userId !== auth.user.id) {
    return jsonError(404, "not_found", "Session not found.");
  }

  await revokeSession(db, sessionId);
  await writeSecurityEvent(db, {
    type: "SESSION_REVOKED",
    severity: "info",
    userId: auth.user.id,
    ip,
    userAgent,
    metadata: { sessionId },
  });

  const res = jsonOk({ status: "ok" as const });
  if (sessionId === auth.session.id) clearSessionCookie(res);
  return res;
});
