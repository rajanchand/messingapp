import { z } from "zod";
import { getDb } from "@zts/database";
import { enterSudoMode, reauthenticate } from "@zts/auth";
import { writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

const bodySchema = z.object({
  password: z.string().min(1).max(128),
});

/** Re-authentication: unlocks sudo mode for dangerous operations. */
export const POST = createApiHandler(
  { bodySchema, rateLimit: "sudo" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const ok = await reauthenticate(db, auth.user.id, body.password);
    if (!ok) {
      await writeSecurityEvent(db, {
        type: "SUDO_FAILED",
        severity: "warning",
        userId: auth.user.id,
        ip,
        userAgent,
      });
      return jsonError(401, "invalid_credentials", "Incorrect password.");
    }
    const sudoUntil = await enterSudoMode(db, auth.session.id);
    return jsonOk({ status: "ok" as const, sudoUntil });
  },
);
