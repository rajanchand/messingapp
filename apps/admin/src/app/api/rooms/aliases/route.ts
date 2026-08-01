import { z } from "zod";
import { getSynapseClient } from "@zts/matrix";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

const resolveQuery = z.object({
  alias: z.string().min(1).max(255),
});

export const GET = createApiHandler(
  { permission: "rooms.read", querySchema: resolveQuery, rateLimit: "api" },
  async ({ query }) => {
    let alias = query.alias.trim();
    if (!alias.startsWith("#")) {
      const server = getEnv().MATRIX_SERVER_NAME;
      alias = `#${alias}:${server}`;
    }
    try {
      const resolved = await getSynapseClient().resolveAlias(alias);
      return jsonOk({ alias, ...resolved });
    } catch {
      return jsonError(404, "not_found", "Alias not found.");
    }
  },
);

const createBody = z.object({
  alias: z.string().min(1).max(255),
  roomId: z.string().min(1).max(255),
});

export const POST = createApiHandler(
  { permission: "rooms.update", bodySchema: createBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    let alias = body.alias.trim();
    if (!alias.startsWith("#")) {
      alias = `#${alias}:${getEnv().MATRIX_SERVER_NAME}`;
    }
    try {
      await getSynapseClient().createAlias(alias, body.roomId);
    } catch (err) {
      return jsonError(
        502,
        "synapse_error",
        err instanceof Error ? err.message : "Failed to create alias",
      );
    }
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_ALIAS_CREATED",
      target: alias,
      ip,
      userAgent,
      metadata: { roomId: body.roomId },
    });
    return jsonOk({ status: "ok" as const, alias }, { status: 201 });
  },
);

const deleteBody = z.object({
  alias: z.string().min(1).max(255),
});

export const DELETE = createApiHandler(
  { permission: "rooms.update", bodySchema: deleteBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    let alias = body.alias.trim();
    if (!alias.startsWith("#")) {
      alias = `#${alias}:${getEnv().MATRIX_SERVER_NAME}`;
    }
    try {
      await getSynapseClient().deleteAlias(alias);
    } catch (err) {
      return jsonError(
        502,
        "synapse_error",
        err instanceof Error ? err.message : "Failed to delete alias",
      );
    }
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROOM_ALIAS_DELETED",
      target: alias,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
