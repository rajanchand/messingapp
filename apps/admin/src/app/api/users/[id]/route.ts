import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, matrixUserProfiles, matrixUserRoles, roles } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

export const GET = createApiHandler(
  { permission: "users.read", rateLimit: "api" },
  async ({ params }) => {
    const userId = requireMatrixUserId(params);
    const synapse = getSynapseClient();
    const db = getDb();

    const [user, devices, joinedRooms, assignedRoles, profile] = await Promise.all([
      synapse.getUser(userId),
      synapse.listDevices(userId).catch(() => ({ devices: [], total: 0 })),
      synapse.getUserJoinedRooms(userId).catch(() => ({ joined_rooms: [], total: 0 })),
      db
        .select({ slug: roles.slug, name: roles.name })
        .from(matrixUserRoles)
        .innerJoin(roles, eq(matrixUserRoles.roleId, roles.id))
        .where(eq(matrixUserRoles.matrixUserId, userId)),
      db
        .select()
        .from(matrixUserProfiles)
        .where(eq(matrixUserProfiles.matrixUserId, userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    return jsonOk({
      user: { ...user, name: userId },
      deviceCount: devices.total,
      rooms: joinedRooms.joined_rooms,
      roomCount: joinedRooms.total,
      roles: assignedRoles,
      profile,
    });
  },
);

const patchBodySchema = z.object({
  displayName: z.string().min(1).max(256),
});

export const PATCH = createApiHandler(
  { permission: "users.update", bodySchema: patchBodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const synapse = getSynapseClient();
    const updated = await synapse.createOrModifyUser(userId, { displayname: body.displayName });

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "USER_UPDATED",
      target: userId,
      ip,
      userAgent,
      metadata: { fields: ["displayname"] },
    });

    return jsonOk({ user: updated });
  },
);
