import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  since: z.string().max(256).optional(),
});

export const GET = createApiHandler(
  { permission: "rooms.read", querySchema: listQuery, rateLimit: "api" },
  async ({ query }) => {
    const result = await getSynapseClient().listPublicRooms({
      limit: query.limit,
      since: query.since,
    });
    return jsonOk({
      rooms: result.chunk,
      nextBatch: result.next_batch ?? null,
      totalEstimate: result.total_room_count_estimate ?? null,
    });
  },
);

const visibilityBody = z.object({
  roomId: z.string().min(1).max(255),
  visibility: z.enum(["public", "private"]),
});

export const PUT = createApiHandler(
  { permission: "rooms.update", bodySchema: visibilityBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    try {
      await getSynapseClient().setRoomDirectoryVisibility(body.roomId, body.visibility);
    } catch (err) {
      return jsonError(
        502,
        "synapse_error",
        err instanceof Error ? err.message : "Failed to update directory visibility",
      );
    }
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_DIRECTORY_VISIBILITY",
      target: body.roomId,
      ip,
      userAgent,
      metadata: { visibility: body.visibility },
    });
    return jsonOk({ status: "ok" as const, visibility: body.visibility });
  },
);
