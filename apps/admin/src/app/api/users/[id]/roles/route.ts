import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, matrixUserRoles, roles } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";

const putBodySchema = z.object({
  roles: z.array(z.string().min(1).max(64)).max(16),
});

/** Replaces the platform roles assigned to a Matrix user. */
export const PUT = createApiHandler(
  { permission: "roles.manage", bodySchema: putBodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const userId = requireMatrixUserId(params);
    const db = getDb();

    const targetRoles =
      body.roles.length > 0
        ? await db.select().from(roles).where(inArray(roles.slug, body.roles))
        : [];
    if (targetRoles.length !== body.roles.length) {
      return jsonError(400, "validation", "One or more roles do not exist.");
    }

    await db.delete(matrixUserRoles).where(eq(matrixUserRoles.matrixUserId, userId));
    if (targetRoles.length > 0) {
      await db.insert(matrixUserRoles).values(
        targetRoles.map((r) => ({
          matrixUserId: userId,
          roleId: r.id,
          assignedBy: auth.user.id,
        })),
      );
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ROLES_ASSIGNED",
      target: userId,
      ip,
      userAgent,
      metadata: { roles: body.roles },
    });

    return jsonOk({ roles: targetRoles.map((r) => ({ slug: r.slug, name: r.name })) });
  },
);

/** Lists roles assigned to a Matrix user. */
export const GET = createApiHandler(
  { permission: "roles.read", rateLimit: "api" },
  async ({ params }) => {
    const userId = requireMatrixUserId(params);
    const db = getDb();
    const assigned = await db
      .select({ slug: roles.slug, name: roles.name })
      .from(matrixUserRoles)
      .innerJoin(roles, eq(matrixUserRoles.roleId, roles.id))
      .where(and(eq(matrixUserRoles.matrixUserId, userId)));
    return jsonOk({ roles: assigned });
  },
);
