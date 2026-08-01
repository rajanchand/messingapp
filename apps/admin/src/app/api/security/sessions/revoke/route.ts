import { z } from "zod";
import { getDb } from "@zts/database";
import { revokeSession } from "@zts/auth";
import { writeAuditLog, writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
});

export const POST = createApiHandler(
  {
    permission: "security.manage",
    bodySchema,
    requireSudo: true,
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    if (body.sessionId === auth.session.id) {
      return jsonError(400, "validation", "Use logout to end your current session.");
    }
    const db = getDb();
    await revokeSession(db, body.sessionId);

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "SESSION_REVOKED",
      target: body.sessionId,
      ip,
      userAgent,
    });
    await writeSecurityEvent(db, {
      type: "SESSION_REVOKED",
      severity: "warning",
      userId: auth.user.id,
      ip,
      metadata: { sessionId: body.sessionId },
    });

    return jsonOk({ revoked: true });
  },
);
