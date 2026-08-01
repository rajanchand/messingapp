import { getDb } from "@zts/database";
import { listActiveSessions } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

/** Lists the caller's own active sessions. */
export const GET = createApiHandler({ rateLimit: "api" }, async ({ auth }) => {
  const sessions = await listActiveSessions(getDb(), auth.user.id);
  return jsonOk({
    sessions: sessions.map((s) => ({ ...s, current: s.id === auth.session.id })),
  });
});
