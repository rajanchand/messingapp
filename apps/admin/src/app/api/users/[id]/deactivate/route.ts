import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

const bodySchema = z.object({
  /** GDPR-style erasure of profile and message metadata. Irreversible. */
  erase: z.boolean().default(false),
});

/** Dangerous operation: requires sudo mode (recent re-authentication). */
export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const synapse = getSynapseClient();
    await synapse.deactivateUser(userId, body.erase);

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: body.erase ? "USER_ERASED" : "USER_DEACTIVATED",
      target: userId,
      ip,
      userAgent,
    });

    const { emitTrigger } = await import("@/lib/automation/emit");
    emitTrigger("USER_DEACTIVATED", {
      userId,
      erase: body.erase,
      actor: auth.user.username,
    });

    return jsonOk({ status: "ok" as const });
  },
);
