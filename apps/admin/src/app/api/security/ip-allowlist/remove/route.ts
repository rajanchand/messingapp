import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, ipAllowlist } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  id: z.string().uuid(),
});

export const POST = createApiHandler(
  { permission: "security.manage", bodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const [removed] = await db
      .delete(ipAllowlist)
      .where(eq(ipAllowlist.id, body.id))
      .returning();
    if (!removed) {
      return jsonError(404, "not_found", "Allowlist entry not found.");
    }
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "IP_ALLOWLIST_REMOVED",
      target: removed.cidr,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
