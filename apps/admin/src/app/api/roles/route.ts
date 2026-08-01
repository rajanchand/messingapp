import { eq } from "drizzle-orm";
import { getDb, rolePermissions, roles } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

/** Lists all roles with their permissions. */
export const GET = createApiHandler(
  { permission: "roles.read", rateLimit: "api" },
  async () => {
    const db = getDb();
    const allRoles = await db.select().from(roles);
    const allRolePerms = await db
      .select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id));

    const permsByRole = new Map<string, string[]>();
    for (const rp of allRolePerms) {
      const list = permsByRole.get(rp.roleId) ?? [];
      list.push(rp.permissionId);
      permsByRole.set(rp.roleId, list);
    }

    return jsonOk({
      roles: allRoles.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: permsByRole.get(r.id) ?? [],
      })),
    });
  },
);
