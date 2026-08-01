/**
 * Creates the first Super Admin account for the admin panel.
 *
 * Usage (interactive):
 *   DATABASE_URL=... pnpm bootstrap-admin
 *
 * Usage (non-interactive, e.g. CI/provisioning):
 *   DATABASE_URL=... ZTS_ADMIN_USERNAME=... ZTS_ADMIN_PASSWORD=... pnpm bootstrap-admin
 *
 * Idempotent: refuses to overwrite an existing account and only ever adds
 * the super_admin role. Passwords are read from stdin without echo and are
 * never logged.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { eq } from "drizzle-orm";
import { adminUsers, getDb, roles, userRoles, seedRbac } from "@zts/database";
import { checkPasswordPolicy, hashPassword } from "@zts/auth";

function ask(question: string, hidden = false): Promise<string> {
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output: hidden ? muted : process.stdout,
    terminal: true,
  });
  if (hidden) process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question(hidden ? "" : question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const db = getDb();

  console.log("Seeding RBAC catalog (idempotent)...");
  await seedRbac();

  const username = (
    process.env.ZTS_ADMIN_USERNAME ?? (await ask("Admin username: "))
  ).toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    console.error("Username must be 3-64 chars: lowercase letters, digits, . _ -");
    process.exit(1);
  }

  const existing = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);
  if (existing.length > 0) {
    console.error(`Account "${username}" already exists. Aborting - nothing was changed.`);
    process.exit(1);
  }

  const password = process.env.ZTS_ADMIN_PASSWORD ?? (await ask("Admin password: ", true));
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    console.error(policy.errors.join("\n"));
    process.exit(1);
  }
  if (!process.env.ZTS_ADMIN_PASSWORD) {
    const confirm = await ask("Confirm password: ", true);
    if (confirm !== password) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(adminUsers)
    .values({ username, passwordHash, displayName: username })
    .returning({ id: adminUsers.id });
  const userId = inserted[0]!.id;

  const superAdmin = (
    await db.select().from(roles).where(eq(roles.slug, "super_admin")).limit(1)
  )[0];
  if (!superAdmin) {
    console.error("super_admin role missing after seed - aborting.");
    process.exit(1);
  }
  await db.insert(userRoles).values({ userId, roleId: superAdmin.id }).onConflictDoNothing();

  console.log(`Super Admin "${username}" created. You can now sign in at /login.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
