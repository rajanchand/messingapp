import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

const bodySchema = z.object({
  shadowBanned: z.boolean(),
});

export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const user = await getSynapseClient().setShadowBan(userId, body.shadowBanned);
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: body.shadowBanned ? "USER_SHADOW_BANNED" : "USER_SHADOW_UNBANNED",
      target: userId,
      ip,
      userAgent,
    });
    return jsonOk({ user });
  },
);
