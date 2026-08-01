import { and, eq } from "drizzle-orm";
import type { Database, Permission } from "@zts/database";
import { rolePermissions, roles, userRoles } from "@zts/database";

export class PermissionError extends Error {
  readonly statusCode = 403;
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Resolves the effective permission set for an admin user via their roles. */
export async function getUserPermissions(db: Database, userId: string): Promise<Set<Permission>> {
  const rows = await db
    .select({ permissionId: rolePermissions.permissionId })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .where(eq(userRoles.userId, userId));
  return new Set(rows.map((r) => r.permissionId as Permission));
}

export async function getUserRoles(db: Database, userId: string) {
  return db
    .select({ id: roles.id, slug: roles.slug, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
}

export function hasPermission(permissions: Set<Permission>, required: Permission): boolean {
  return permissions.has(required);
}

/**
 * Server-side enforcement point. Throws PermissionError (403) if the
 * resolved permission set does not include the required permission.
 */
export function requirePermission(permissions: Set<Permission>, required: Permission): void {
  if (!permissions.has(required)) {
    throw new PermissionError(required);
  }
}

export async function assignRole(
  db: Database,
  userId: string,
  roleSlug: string,
  assignedBy: string | null,
): Promise<boolean> {
  const role = (await db.select().from(roles).where(eq(roles.slug, roleSlug)).limit(1))[0];
  if (!role) return false;
  await db
    .insert(userRoles)
    .values({ userId, roleId: role.id, assignedBy })
    .onConflictDoNothing();
  return true;
}

export async function revokeRole(db: Database, userId: string, roleSlug: string): Promise<boolean> {
  const role = (await db.select().from(roles).where(eq(roles.slug, roleSlug)).limit(1))[0];
  if (!role) return false;
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
  return true;
}
