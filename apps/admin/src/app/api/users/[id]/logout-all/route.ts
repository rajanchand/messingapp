import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

/** Logs the Matrix user out of all devices by deleting them. */
export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const synapse = getSynapseClient();
    const count = await synapse.logoutAllDevices(userId);

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "USER_SESSIONS_TERMINATED",
      target: userId,
      ip,
      userAgent,
      metadata: { deviceCount: count },
    });

    return jsonOk({ status: "ok" as const, devicesRemoved: count });
  },
);
