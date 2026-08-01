import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { checkPasswordPolicy } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

const bodySchema = z.object({
  password: z.string().min(1).max(128),
  logoutDevices: z.boolean().default(true),
});

/** Dangerous operation: requires sudo mode. The password is never logged. */
export const POST = createApiHandler(
  { permission: "users.update", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const policy = checkPasswordPolicy(body.password);
    if (!policy.ok) return jsonError(400, "weak_password", policy.errors.join(" "));

    const synapse = getSynapseClient();
    await synapse.resetPassword(userId, body.password, body.logoutDevices);

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "PASSWORD_RESET",
      target: userId,
      ip,
      userAgent,
      metadata: { logoutDevices: body.logoutDevices },
    });

    return jsonOk({ status: "ok" as const });
  },
);
