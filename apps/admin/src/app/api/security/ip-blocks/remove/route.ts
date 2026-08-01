import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, ipBlocks } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

export const POST = createApiHandler(
  {
    permission: "security.manage",
    bodySchema: z.object({ id: z.string().uuid() }),
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const [removed] = await db.delete(ipBlocks).where(eq(ipBlocks.id, body.id)).returning();
    if (!removed) return jsonError(404, "not_found", "IP block not found.");

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "IP_UNBLOCKED",
      target: removed.cidr,
      ip,
      userAgent,
    });

    return jsonOk({ block: removed });
  },
);
