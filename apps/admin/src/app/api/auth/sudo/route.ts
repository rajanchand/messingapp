import { z } from "zod";
import { getDb } from "@zts/database";
import {
  enterSudoMode,
  finishWebAuthnAuthentication,
  reauthenticate,
  signExpiringValue,
  startWebAuthnAuthentication,
  verifyExpiringValue,
} from "@zts/auth";
import { writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
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

/** Password (legacy + default), passkey begin, or passkey finish. */
const bodySchema = z.union([
  z.object({
    method: z.literal("webauthn_begin"),
  }),
  z.object({
    method: z.literal("webauthn"),
    challengeToken: z.string().min(1),
    response: z.object({
      id: z.string(),
      rawId: z.string(),
      type: z.string(),
      response: z.unknown(),
      clientExtensionResults: z.unknown().optional(),
    }),
  }),
  z.object({
    method: z.literal("password").optional(),
    password: z.string().min(1).max(128),
  }),
]);

/** Re-authentication: unlocks sudo mode for dangerous operations (password or passkey). */
export const POST = createApiHandler(
  { bodySchema, rateLimit: "sudo" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const env = getEnv();

    if ("method" in body && body.method === "webauthn_begin") {
      const rp = rpConfig();
      const options = await startWebAuthnAuthentication(db, auth.user.id, rp);
      const challengeToken = signExpiringValue(env.SESSION_SECRET, options.challenge, 5 * 60 * 1000);
      return jsonOk({ status: "webauthn_begin" as const, options, challengeToken });
    }

    if ("method" in body && body.method === "webauthn") {
      const challenge = verifyExpiringValue(env.SESSION_SECRET, body.challengeToken);
      if (!challenge) {
        return jsonError(401, "mfa_expired", "Passkey challenge expired.");
      }
      try {
        const { userId } = await finishWebAuthnAuthentication(
          db,
          rpConfig(),
          challenge.value,
          body.response,
        );
        if (userId !== auth.user.id) {
          return jsonError(401, "invalid_credentials", "Passkey does not match this account.");
        }
      } catch {
        await writeSecurityEvent(db, {
          type: "SUDO_FAILED",
          severity: "warning",
          userId: auth.user.id,
          ip,
          userAgent,
          metadata: { method: "webauthn" },
        });
        return jsonError(401, "invalid_credentials", "Passkey verification failed.");
      }
      const sudoUntil = await enterSudoMode(db, auth.session.id);
      return jsonOk({ status: "ok" as const, sudoUntil });
    }

    const password = "password" in body ? body.password : "";
    const ok = await reauthenticate(db, auth.user.id, password);
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
