import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, webhookEndpoints, webhookDeliveries } from "@zts/database";
import { decryptSecret, hashToken } from "@zts/auth";
import { dispatchTriggerSafe } from "@zts/automation";
import { getRedis } from "@zts/security";
import { createPublicApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

function verifyHmac(secret: string, rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/i, "");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const POST = createPublicApiHandler(
  { rateLimit: "mutation", rateLimitName: "webhook_inbound" },
  async ({ req, params, ip }) => {
    const slug = params.slug!;
    const db = getDb();
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.slug, slug));

    if (!endpoint || !endpoint.enabled) {
      return jsonError(404, "not_found", "Webhook endpoint not found.");
    }

    const rawBody = await req.text();
    const env = getEnv();
    const secret = decryptSecret(env.SESSION_SECRET, endpoint.encryptedSecret);
    const signature = req.headers.get("x-zts-signature") ?? req.headers.get("x-hub-signature-256");
    const timestamp = req.headers.get("x-zts-timestamp");
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (timestamp) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
        return jsonError(401, "replay", "Webhook timestamp outside allowed window.");
      }
    }

    const authorized =
      (signature ? verifyHmac(secret, rawBody, signature) : false) ||
      (bearer ? bearer === secret : false);
    if (!authorized) {
      return jsonError(401, "unauthorized", "Invalid webhook signature.");
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return jsonError(400, "invalid_json", "Body must be JSON.");
    }

    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      direction: "inbound",
      status: "accepted",
      httpStatus: 200,
      requestId: req.headers.get("x-request-id"),
      payloadHash: hashToken(rawBody || "{}"),
    });

    await dispatchTriggerSafe(db, getRedis(), "WEBHOOK_RECEIVED", {
      endpointId: endpoint.id,
      slug: endpoint.slug,
      payload,
      ip,
    });

    return jsonOk({ received: true });
  },
);
