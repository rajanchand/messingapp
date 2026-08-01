import { z } from "zod";
import { getDb } from "@zts/database";
import { createSession, verifyExpiringValue, verifyMfaChallenge } from "@zts/auth";
import { createPublicApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import {
  MFA_PENDING_COOKIE,
  clearMfaPendingCookie,
  setSessionCookie,
} from "@/lib/api/cookies";
import { getEnv, getMfaEncryptionKey } from "@/lib/env";

const bodySchema = z.object({
  code: z.string().min(6).max(32),
});

/** Second factor step: verifies TOTP or recovery code and creates the session. */
export const POST = createPublicApiHandler(
  { bodySchema, rateLimit: "mfa" },
  async ({ req, body, ip, userAgent }) => {
    const env = getEnv();
    const pendingCookie = req.cookies.get(MFA_PENDING_COOKIE)?.value;
    if (!pendingCookie) {
      return jsonError(401, "mfa_expired", "MFA challenge expired. Please log in again.");
    }
    const payload = verifyExpiringValue(env.SESSION_SECRET, pendingCookie);
    if (!payload || !payload.value.startsWith("mfa:")) {
      return jsonError(401, "mfa_expired", "MFA challenge expired. Please log in again.");
    }
    const userId = payload.value.slice("mfa:".length);

    const db = getDb();
    const result = await verifyMfaChallenge(db, getMfaEncryptionKey(), userId, body.code, {
      ip,
      userAgent,
    });
    if (!result.ok) {
      if (result.locked) {
        const res = jsonError(
          423,
          "locked",
          "Account temporarily locked due to failed authentication attempts. Try again later.",
        );
        clearMfaPendingCookie(res);
        return res;
      }
      return jsonError(401, "mfa_invalid", "Invalid authentication code.");
    }

    const session = await createSession(db, userId, { ip, userAgent });
    const res = jsonOk({ status: "ok" as const, usedRecoveryCode: result.usedRecoveryCode });
    setSessionCookie(res, session.token, session.expiresAt);
    clearMfaPendingCookie(res);
    return res;
  },
);
