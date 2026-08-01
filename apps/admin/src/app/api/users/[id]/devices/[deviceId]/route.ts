import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { ApiError } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

/** Removes a single device, logging that device out. */
export const DELETE = createApiHandler(
  { permission: "users.disable", rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const deviceId = params.deviceId;
    if (!deviceId || deviceId.length > 255) {
      throw new ApiError(400, "validation", "Invalid device id.");
    }

    await getSynapseClient().deleteDevice(userId, deviceId);

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "DEVICE_REMOVED",
      target: userId,
      ip,
      userAgent,
      metadata: { deviceId },
    });

    return jsonOk({ status: "ok" as const });
  },
);
