import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminUsers, getDb } from "@zts/database";
import {
  createSession,
  finishWebAuthnAuthentication,
  signExpiringValue,
  startWebAuthnAuthentication,
  verifyExpiringValue,
} from "@zts/auth";
import { writeSecurityEvent } from "@zts/security";
import { createPublicApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { MFA_PENDING_COOKIE, clearMfaPendingCookie, setSessionCookie } from "@/lib/api/cookies";
import { getEnv } from "@/lib/env";

function rpConfig() {
  const env = getEnv();
  const host = env.ADMIN_DOMAIN.replace(/^https?:\/\//, "").split("/")[0]!;
  const rpID = env.WEBAUTHN_RP_ID ?? host.split(":")[0]!;
  const origin =
    env.WEBAUTHN_RP_ORIGIN ??
    (env.NODE_ENV === "production" ? `https://${host}` : `http://${host}`);
  return { rpID, rpName: env.APP_NAME, origin };
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("begin"),
    /** Optional; scopes allowCredentials. MFA step can omit and use pending cookie. */
    username: z.string().min(1).max(255).optional(),
  }),
  z.object({
    action: z.literal("finish"),
    challengeToken: z.string().min(1),
    response: z.object({
      id: z.string(),
      rawId: z.string(),
      type: z.string(),
      response: z.unknown(),
      clientExtensionResults: z.unknown().optional(),
    }),
    /** Completes MFA after password login (requires mfa-pending cookie). */
    asSecondFactor: z.boolean().optional(),
  }),
]);

/** Begin/finish WebAuthn authentication for login or MFA step-up. */
export const POST = createPublicApiHandler(
  { rateLimit: "login", bodySchema },
  async ({ req, body, ip, userAgent }) => {
    const env = getEnv();
    const db = getDb();
    const rp = rpConfig();

    if (body.action === "begin") {
      let userId: string | null = null;
      if (body.username) {
        const normalized = body.username.trim().toLowerCase();
        const user = (
          await db.select().from(adminUsers).where(eq(adminUsers.username, normalized)).limit(1)
        )[0];
        if (user?.isActive) userId = user.id;
      } else {
        const pendingCookie = req.cookies.get(MFA_PENDING_COOKIE)?.value;
        if (pendingCookie) {
          const payload = verifyExpiringValue(env.SESSION_SECRET, pendingCookie);
          if (payload?.value.startsWith("mfa:")) {
            userId = payload.value.slice("mfa:".length);
          }
        }
      }

      const options = await startWebAuthnAuthentication(db, userId, rp);
      const challengeToken = signExpiringValue(env.SESSION_SECRET, options.challenge, 5 * 60 * 1000);
      return jsonOk({ options, challengeToken });
    }

    const challenge = verifyExpiringValue(env.SESSION_SECRET, body.challengeToken);
    if (!challenge) {
      return jsonError(401, "mfa_expired", "Passkey challenge expired. Please try again.");
    }

    try {
      const { userId } = await finishWebAuthnAuthentication(db, rp, challenge.value, body.response);

      const user = (
        await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1)
      )[0];
      if (!user || !user.isActive) {
        return jsonError(401, "invalid_credentials", "Account is not active.");
      }

      if (body.asSecondFactor) {
        const pendingCookie = req.cookies.get(MFA_PENDING_COOKIE)?.value;
        if (!pendingCookie) {
          return jsonError(401, "mfa_expired", "MFA challenge expired. Please log in again.");
        }
        const pending = verifyExpiringValue(env.SESSION_SECRET, pendingCookie);
        if (!pending || pending.value !== `mfa:${userId}`) {
          return jsonError(401, "mfa_invalid", "Passkey does not match the pending login.");
        }
      }

      await db
        .update(adminUsers)
        .set({
          lastLoginAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          mfaEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(adminUsers.id, userId));

      const session = await createSession(db, userId, { ip, userAgent });
      const res = jsonOk({ status: "ok" as const });
      setSessionCookie(res, session.token, session.expiresAt);
      clearMfaPendingCookie(res);
      return res;
    } catch {
      await writeSecurityEvent(db, {
        type: "WEBAUTHN_LOGIN_FAILED",
        severity: "warning",
        ip,
        userAgent,
      });
      return jsonError(401, "webauthn_failed", "Passkey authentication failed.");
    }
  },
);
