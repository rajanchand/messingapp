import { z } from "zod";
import { getDb } from "@zts/database";
import { createSession, loginWithPassword, signExpiringValue } from "@zts/auth";
import { createPublicApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { setMfaPendingCookie, setSessionCookie } from "@/lib/api/cookies";
import { getEnv } from "@/lib/env";

const MFA_PENDING_TTL_MS = 5 * 60 * 1000;

const bodySchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});

export const POST = createPublicApiHandler(
  { bodySchema, rateLimit: "login" },
  async ({ body, ip, userAgent }) => {
    const db = getDb();
    const result = await loginWithPassword(db, body.username, body.password, { ip, userAgent });

    switch (result.status) {
      case "invalid":
        return jsonError(401, "invalid_credentials", "Invalid username or password.");
      case "locked":
        return jsonError(
          423,
          "locked",
          "Account temporarily locked due to failed login attempts. Try again later.",
        );
      case "mfa_required": {
        const res = jsonOk({ status: "mfa_required" as const });
        const pending = signExpiringValue(
          getEnv().SESSION_SECRET,
          `mfa:${result.user.id}`,
          MFA_PENDING_TTL_MS,
        );
        setMfaPendingCookie(res, pending, MFA_PENDING_TTL_MS / 1000);
        return res;
      }
      case "success": {
        const session = await createSession(db, result.user.id, { ip, userAgent });
        const res = jsonOk({ status: "ok" as const });
        setSessionCookie(res, session.token, session.expiresAt);
        return res;
      }
    }
  },
);
