import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "rooms.read", rateLimit: "api" },
  async ({ params }) => {
    const roomId = decodeURIComponent(params.id!);
    const synapse = getSynapseClient();
    const [room, members] = await Promise.all([
      synapse.getRoom(roomId),
      synapse.listRoomMembers(roomId, { limit: 200 }),
    ]);
    return jsonOk({ room, members: members.members, memberTotal: members.total });
  },
);

const patchBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  topic: z.string().max(1024).optional(),
  joinRule: z.enum(["public", "invite", "knock", "restricted"]).optional(),
});

export const PATCH = createApiHandler(
  { permission: "rooms.update", bodySchema: patchBodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const roomId = decodeURIComponent(params.id!);
    const synapse = getSynapseClient();
    if (body.name !== undefined) {
      await synapse.setRoomState(roomId, "m.room.name", "", { name: body.name });
    }
    if (body.topic !== undefined) {
      await synapse.setRoomState(roomId, "m.room.topic", "", { topic: body.topic });
    }
    if (body.joinRule !== undefined) {
      await synapse.setRoomState(roomId, "m.room.join_rules", "", { join_rule: body.joinRule });
    }
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_UPDATED",
      target: roomId,
      ip,
      userAgent,
      metadata: body,
    });
    const room = await synapse.getRoom(roomId);
    return jsonOk({ room });
  },
);

export const DELETE = createApiHandler(
  { permission: "rooms.delete", requireSudo: true, rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const roomId = decodeURIComponent(params.id!);
    const result = await getSynapseClient().deleteRoom(roomId, { purge: true, block: true });
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_DELETED",
      target: roomId,
      ip,
      userAgent,
      metadata: { kicked: result.kicked_users },
    });
    return jsonOk({ result });
  },
);
