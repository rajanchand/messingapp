import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const listQuerySchema = z.object({
  search: z.string().max(255).optional(),
  from: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = createApiHandler(
  { permission: "rooms.read", querySchema: listQuerySchema, rateLimit: "api" },
  async ({ query }) => {
    const result = await getSynapseClient().listRooms({
      from: query.from,
      limit: query.limit,
      search_term: query.search || undefined,
    });
    return jsonOk({
      rooms: result.rooms,
      total: result.total_rooms,
      nextFrom: result.next_batch ?? null,
    });
  },
);

const createBodySchema = z.object({
  name: z.string().min(1).max(255),
  topic: z.string().max(1024).optional(),
  alias: z.string().max(255).optional(),
  encryption: z.boolean().default(true),
  visibility: z.enum(["public", "private"]).default("private"),
  invite: z.array(z.string().max(255)).max(50).default([]),
});

export const POST = createApiHandler(
  { permission: "rooms.create", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const created = await getSynapseClient().createRoom({
      name: body.name,
      topic: body.topic,
      room_alias_name: body.alias,
      encryption: body.encryption,
      visibility: body.visibility,
      invite: body.invite,
      preset: body.visibility === "public" ? "public_chat" : "private_chat",
    });

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_CREATED",
      target: created.room_id,
      ip,
      userAgent,
      metadata: { name: body.name, encryption: body.encryption },
    });

    const { emitTrigger } = await import("@/lib/automation/emit");
    emitTrigger("ROOM_CREATED", {
      roomId: created.room_id,
      name: body.name,
      actor: auth.user.username,
    });

    return jsonOk({ room: created }, { status: 201 });
  },
);
