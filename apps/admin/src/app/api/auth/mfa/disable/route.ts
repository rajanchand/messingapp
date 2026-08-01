import { z } from "zod";
import { getDb } from "@zts/database";
import { disableTotp, reauthenticate } from "@zts/auth";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  password: z.string().min(1).max(128),
});

/** Disabling MFA is dangerous: requires the current password explicitly. */
export const POST = createApiHandler(
  { bodySchema, rateLimit: "sudo" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const ok = await reauthenticate(db, auth.user.id, body.password);
    if (!ok) return jsonError(401, "invalid_credentials", "Incorrect password.");

    await disableTotp(db, auth.user.id);
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "MFA_DISABLED",
      target: auth.user.username,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" as const });
  },
);
