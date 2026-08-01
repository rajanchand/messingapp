import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const querySchema = z.object({
  userId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
});

export const GET = createApiHandler(
  { permission: "media.read", querySchema, rateLimit: "api" },
  async ({ query }) => {
    if (!query.userId && !query.roomId) {
      return jsonError(400, "validation", "Provide userId or roomId.");
    }
    const synapse = getSynapseClient();
    const data = query.userId
      ? await synapse.listUserMedia(query.userId)
      : await synapse.listRoomMedia(query.roomId!);
    return jsonOk(data);
  },
);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["quarantine", "unquarantine", "delete"]),
    serverName: z.string().min(1),
    mediaId: z.string().min(1),
  }),
]);

export const POST = createApiHandler(
  { permission: "media.manage", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const synapse = getSynapseClient();
    if (body.action === "quarantine") {
      await synapse.quarantineMedia(body.serverName, body.mediaId);
    } else if (body.action === "unquarantine") {
      await synapse.unquarantineMedia(body.serverName, body.mediaId);
    } else {
      await synapse.deleteMedia(body.serverName, body.mediaId);
    }
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: `MEDIA_${body.action.toUpperCase()}`,
      target: `${body.serverName}/${body.mediaId}`,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
