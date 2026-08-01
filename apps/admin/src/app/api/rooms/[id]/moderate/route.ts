import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  userId: z.string().min(1).max(255),
  action: z.enum(["kick", "ban", "unban", "invite"]),
  reason: z.string().max(512).optional(),
});

export const POST = createApiHandler(
  { permission: "rooms.moderate", bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const roomId = decodeURIComponent(params.id!);
    const synapse = getSynapseClient();

    switch (body.action) {
      case "kick":
        await synapse.kickUser(roomId, body.userId, body.reason);
        break;
      case "ban":
        await synapse.banUser(roomId, body.userId, body.reason);
        break;
      case "unban":
        await synapse.unbanUser(roomId, body.userId);
        break;
      case "invite":
        await synapse.inviteUser(roomId, body.userId);
        break;
      default:
        return jsonError(400, "validation", "Unknown moderation action.");
    }

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: `ROOM_${body.action.toUpperCase()}`,
      target: roomId,
      ip,
      userAgent,
      metadata: { userId: body.userId, reason: body.reason },
    });

    return jsonOk({ ok: true });
  },
);
