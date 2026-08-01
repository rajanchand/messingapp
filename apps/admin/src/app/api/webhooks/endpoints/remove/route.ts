import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, webhookEndpoints } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

export const POST = createApiHandler(
  {
    permission: "automation.delete",
    bodySchema: z.object({ id: z.string().uuid() }),
    requireSudo: true,
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const [removed] = await db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.id, body.id))
      .returning();
    if (!removed) return jsonError(404, "not_found", "Endpoint not found.");
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WEBHOOK_ENDPOINT_DELETED",
      target: removed.id,
      ip,
      userAgent,
    });
    return jsonOk({ deleted: true });
  },
);
