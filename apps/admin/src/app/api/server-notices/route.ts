import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const bodySchema = z.object({
  userId: z.string().min(1),
  body: z.string().min(1).max(4000),
});

export const POST = createApiHandler(
  { permission: "users.update", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const result = await getSynapseClient().sendServerNotice(body.userId, { body: body.body });
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "SERVER_NOTICE_SENT",
      target: body.userId,
      ip,
      userAgent,
    });
    return jsonOk(result);
  },
);
