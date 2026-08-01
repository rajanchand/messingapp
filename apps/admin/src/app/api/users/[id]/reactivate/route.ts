import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { checkPasswordPolicy } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

const bodySchema = z.object({
  /** Reactivated accounts need a new password to be able to log in again. */
  password: z.string().min(1).max(128),
});

export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const policy = checkPasswordPolicy(body.password);
    if (!policy.ok) return jsonError(400, "weak_password", policy.errors.join(" "));

    const synapse = getSynapseClient();
    const user = await synapse.createOrModifyUser(userId, {
      deactivated: false,
      password: body.password,
    });

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "USER_REACTIVATED",
      target: userId,
      ip,
      userAgent,
    });

    const { emitTrigger } = await import("@/lib/automation/emit");
    emitTrigger("USER_REACTIVATED", {
      userId,
      actor: auth.user.username,
    });

    return jsonOk({ user });
  },
);
