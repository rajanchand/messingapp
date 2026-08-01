import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminUsers, getDb } from "@zts/database";
import {
  checkPasswordPolicy,
  hashPassword,
  reauthenticate,
  revokeAllSessions,
} from "@zts/auth";
import { writeAuditLog, writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export const POST = createApiHandler(
  { bodySchema, rateLimit: "sudo" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();

    const ok = await reauthenticate(db, auth.user.id, body.currentPassword);
    if (!ok) return jsonError(401, "invalid_credentials", "Current password is incorrect.");

    const policy = checkPasswordPolicy(body.newPassword);
    if (!policy.ok) {
      return jsonError(400, "weak_password", policy.errors.join(" "));
    }

    await db
      .update(adminUsers)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
      .where(eq(adminUsers.id, auth.user.id));

    // Password change invalidates every other session.
    await revokeAllSessions(db, auth.user.id, auth.session.id);

    await writeSecurityEvent(db, {
      type: "PASSWORD_CHANGED",
      severity: "info",
      userId: auth.user.id,
      ip,
      userAgent,
    });
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "PASSWORD_CHANGED",
      target: auth.user.username,
      ip,
      userAgent,
    });

    return jsonOk({ status: "ok" as const });
  },
);
