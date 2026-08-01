import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const bodySchema = z.object({
  userId: z.string().min(1),
});

export const POST = createApiHandler(
  { permission: "rooms.moderate", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const roomId = decodeURIComponent(params.id!);
    await getSynapseClient().makeRoomAdmin(roomId, body.userId);
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_MAKE_ADMIN",
      target: `${roomId}:${body.userId}`,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
