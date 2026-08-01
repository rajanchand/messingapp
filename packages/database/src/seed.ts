import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { permissions, rolePermissions, roles } from "./schema";
import { PERMISSIONS, SYSTEM_ROLES } from "./rbac-catalog";

/**
 * Idempotently seeds the permission catalog and system roles.
 * Safe to run multiple times; safe to run on an existing database.
 */
export async function seedRbac() {
  const db = getDb();

  for (const [id, description] of Object.entries(PERMISSIONS)) {
    await db
      .insert(permissions)
      .values({ id, description })
      .onConflictDoUpdate({ target: permissions.id, set: { description } });
  }

  for (const def of SYSTEM_ROLES) {
    const existing = await db.select().from(roles).where(eq(roles.slug, def.slug)).limit(1);
    let roleId: string;
    if (existing.length > 0 && existing[0]) {
      roleId = existing[0].id;
      await db
        .update(roles)
        .set({ name: def.name, description: def.description, isSystem: true })
        .where(eq(roles.id, roleId));
    } else {
      const inserted = await db
        .insert(roles)
        .values({ slug: def.slug, name: def.name, description: def.description, isSystem: true })
        .returning({ id: roles.id });
      roleId = inserted[0]!.id;
    }

    // Re-sync permissions for system roles to match the catalog exactly.
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (def.permissions.length > 0) {
      await db
        .insert(rolePermissions)
        .values(def.permissions.map((p) => ({ roleId, permissionId: p })))
        .onConflictDoNothing();
    }
  }
}

// Allow direct execution: pnpm --filter @zts/database db:seed
const isDirectRun = process.argv[1]?.endsWith("seed.ts");
if (isDirectRun) {
  seedRbac()
    .then(() => {
      console.log("RBAC catalog seeded.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
