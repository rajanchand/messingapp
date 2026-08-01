import { z } from "zod";
import { getDb } from "@zts/database";
import { confirmTotpEnrollment } from "@zts/auth";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});

/** Confirms enrollment; returns recovery codes exactly once. */
export const POST = createApiHandler(
  { bodySchema, rateLimit: "mfa" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const result = await confirmTotpEnrollment(db, getEnv().SESSION_SECRET, auth.user.id, body.code);
    if (!result.ok) {
      return jsonError(400, "mfa_invalid", "Invalid code. Check your authenticator app.");
    }
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "MFA_ENABLED",
      target: auth.user.username,
      ip,
      userAgent,
    });
    return jsonOk({ recoveryCodes: result.recoveryCodes });
  },
);
