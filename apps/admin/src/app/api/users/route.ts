import { z } from "zod";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getDb,
  matrixUserProfiles,
  matrixUserRoles,
  roles,
} from "@zts/database";
import { getSynapseClient, buildMatrixUserId, isValidLocalpart } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { checkPasswordPolicy } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { sendUserWelcomeEmail } from "@/lib/email/welcome";

const listQuerySchema = z.object({
  search: z.string().max(255).optional(),
  from: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["all", "active", "deactivated"]).default("active"),
  admins: z.enum(["true", "false"]).optional(),
  order_by: z.enum(["name", "displayname", "creation_ts", "last_seen_ts"]).default("name"),
  dir: z.enum(["f", "b"]).default("f"),
});

export const GET = createApiHandler(
  { permission: "users.read", querySchema: listQuerySchema, rateLimit: "api" },
  async ({ query }) => {
    const synapse = getSynapseClient();
    const result = await synapse.listUsers({
      from: query.from,
      limit: query.limit,
      name: query.search || undefined,
      deactivated: query.status === "all" ? true : query.status === "deactivated",
      admins: query.admins === undefined ? undefined : query.admins === "true",
      order_by: query.order_by,
      dir: query.dir,
    });

    // The admin API's `deactivated=true` INCLUDES deactivated users alongside
    // active ones; filter precisely for the "deactivated" view.
    const users =
      query.status === "deactivated"
        ? result.users.filter((u) => u.deactivated)
        : result.users;

    return jsonOk({
      users,
      total: result.total,
      nextToken: result.next_token ?? null,
    });
  },
);

const createBodySchema = z.object({
  localpart: z.string().min(1).max(255),
  /** Optional when generateTemporary is true. */
  password: z.string().min(1).max(128).optional(),
  /** Auto-generate a strong temporary password (returned once + emailed if welcome on). */
  generateTemporary: z.boolean().default(false),
  displayName: z.string().min(1).max(256),
  email: z.string().email().max(320),
  phone: z.string().max(32).optional().or(z.literal("")),
  employeeId: z.string().max(64).optional().or(z.literal("")),
  department: z.string().max(128).optional().or(z.literal("")),
  subdepartment: z.string().max(128).optional().or(z.literal("")),
  /** Platform role slug from the RBAC catalog (e.g. user, moderator). */
  roleSlug: z.string().max(64).optional().or(z.literal("")),
  admin: z.boolean().default(false),
  sendWelcomeEmail: z.boolean().default(true),
});

function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i]! % alphabet.length];
  // Ensure complexity classes for password policy.
  return `Aa1!${out}`;
}

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 7 ? digits : undefined;
}

export const POST = createApiHandler(
  { permission: "users.create", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const localpart = body.localpart.trim().toLowerCase();
    if (!isValidLocalpart(localpart)) {
      return jsonError(
        400,
        "validation",
        "Username may only contain lowercase letters, digits, and . _ = - /",
      );
    }

    const password =
      body.generateTemporary || !body.password ? generateTemporaryPassword() : body.password;
    const temporaryGenerated = body.generateTemporary || !body.password;
    const policy = checkPasswordPolicy(password);
    if (!policy.ok) return jsonError(400, "weak_password", policy.errors.join(" "));

    const env = getEnv();
    const userId = buildMatrixUserId(localpart, env.MATRIX_SERVER_NAME);
    const synapse = getSynapseClient();
    const db = getDb();

    // Refuse to overwrite an existing account via the create path.
    const existing = await synapse.getUser(userId).catch(() => null);
    if (existing) {
      return jsonError(409, "conflict", "A user with this username already exists.");
    }

    const displayName = body.displayName.trim();
    const email = body.email.trim().toLowerCase();
    const phone = normalizePhone(body.phone);
    const employeeId = body.employeeId?.trim() || null;
    const department = body.department?.trim() || null;
    const subdepartment = body.subdepartment?.trim() || null;
    const roleSlug = body.roleSlug?.trim() || null;

    let roleRow: typeof roles.$inferSelect | undefined;
    if (roleSlug) {
      roleRow = (await db.select().from(roles).where(eq(roles.slug, roleSlug)).limit(1))[0];
      if (!roleRow) {
        return jsonError(400, "validation", `Unknown role slug: ${roleSlug}`);
      }
    }

    const threepids: { medium: string; address: string }[] = [
      { medium: "email", address: email },
    ];
    if (phone) {
      threepids.push({ medium: "msisdn", address: phone });
    }

    const created = await synapse.createOrModifyUser(userId, {
      password,
      displayname: displayName,
      admin: body.admin,
      threepids,
    });

    if (roleRow) {
      await db
        .insert(matrixUserRoles)
        .values({
          matrixUserId: userId,
          roleId: roleRow.id,
          assignedBy: auth.user.id,
        })
        .onConflictDoNothing();
    }

    await db
      .insert(matrixUserProfiles)
      .values({
        matrixUserId: userId,
        displayName,
        email,
        phone: phone ?? null,
        employeeId,
        department,
        subdepartment,
        primaryRoleSlug: roleSlug,
        createdBy: auth.user.id,
      })
      .onConflictDoUpdate({
        target: matrixUserProfiles.matrixUserId,
        set: {
          displayName,
          email,
          phone: phone ?? null,
          employeeId,
          department,
          subdepartment,
          primaryRoleSlug: roleSlug,
          updatedAt: new Date(),
        },
      });

    let emailResult: { sent: boolean; skippedReason?: string; error?: string } = {
      sent: false,
      skippedReason: "Welcome email disabled for this create.",
    };
    if (body.sendWelcomeEmail) {
      emailResult = await sendUserWelcomeEmail({
        to: email,
        displayName,
        matrixUserId: userId,
        localpart,
        password,
        department,
        subdepartment,
        employeeId,
      });
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "USER_CREATED",
      target: userId,
      ip,
      userAgent,
      metadata: {
        admin: body.admin,
        email,
        phone: phone ?? null,
        department,
        subdepartment,
        employeeId,
        roleSlug,
        welcomeEmailSent: emailResult.sent,
        temporaryPassword: temporaryGenerated,
      },
    });

    const { emitTrigger } = await import("@/lib/automation/emit");
    emitTrigger("USER_CREATED", {
      userId,
      admin: body.admin,
      actor: auth.user.username,
      email,
      department,
    });

    return jsonOk(
      {
        user: created,
        welcomeEmail: emailResult,
        /** Only returned when auto-generated — operator should copy once. */
        temporaryPassword: temporaryGenerated ? password : undefined,
      },
      { status: 201 },
    );
  },
);
