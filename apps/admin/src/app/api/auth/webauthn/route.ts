import { z } from "zod";
import { getDb } from "@zts/database";
import {
  startWebAuthnRegistration,
  finishWebAuthnRegistration,
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  signExpiringValue,
  verifyExpiringValue,
} from "@zts/auth";
import { writeAuditLog, writeSecurityEvent } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

function rpConfig() {
  const env = getEnv();
  const host = env.ADMIN_DOMAIN.replace(/^https?:\/\//, "").split("/")[0]!;
  const rpID = host.split(":")[0]!;
  const origin =
    env.NODE_ENV === "production" ? `https://${host}` : `http://${host}`;
  return { rpID, rpName: env.APP_NAME, origin };
}

export const GET = createApiHandler({ rateLimit: "api" }, async ({ auth }) => {
  const rows = await listWebAuthnCredentials(getDb(), auth.user.id);
  return jsonOk({
    credentials: rows.map((c) => ({
      id: c.id,
      credentialId: c.credentialId,
      nickname: c.nickname,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = createApiHandler(
  {
    rateLimit: "mutation",
    bodySchema: z.object({
      action: z.enum(["begin", "finish", "delete"]),
      nickname: z.string().max(64).optional(),
      response: z.unknown().optional(),
      challengeToken: z.string().optional(),
      credentialId: z.string().optional(),
    }),
  },
  async ({ auth, body, ip, userAgent }) => {
    const env = getEnv();
    const rp = rpConfig();
    const db = getDb();

    if (body.action === "begin") {
      const options = await startWebAuthnRegistration(db, auth.user.id, rp);
      const challengeToken = signExpiringValue(
        env.SESSION_SECRET,
        options.challenge,
        5 * 60 * 1000,
      );
      return jsonOk({ options, challengeToken });
    }

    if (body.action === "finish") {
      if (!body.response || !body.challengeToken) {
        return jsonError(400, "validation", "response and challengeToken are required.");
      }
      const challenge = verifyExpiringValue(env.SESSION_SECRET, body.challengeToken);
      if (!challenge) return jsonError(400, "validation", "Registration challenge expired.");
      try {
        await finishWebAuthnRegistration(
          db,
          auth.user.id,
          rp,
          challenge.value,
          body.response,
          body.nickname,
        );
      } catch {
        return jsonError(400, "webauthn_failed", "Passkey registration failed.");
      }
      await writeAuditLog(db, {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "WEBAUTHN_REGISTERED",
        target: auth.user.id,
        ip,
        userAgent,
      });
      await writeSecurityEvent(db, {
        type: "WEBAUTHN_REGISTERED",
        severity: "info",
        userId: auth.user.id,
        ip,
        userAgent,
      });
      return jsonOk({ status: "ok" });
    }

    if (body.action === "delete") {
      if (!body.credentialId) {
        return jsonError(400, "validation", "credentialId is required.");
      }
      await deleteWebAuthnCredential(db, auth.user.id, body.credentialId);
      await writeAuditLog(db, {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "WEBAUTHN_REMOVED",
        target: body.credentialId,
        ip,
        userAgent,
      });
      return jsonOk({ status: "ok" });
    }

    return jsonError(400, "validation", "Unknown action.");
  },
);
