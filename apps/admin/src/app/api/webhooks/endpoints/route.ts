import { randomBytes } from "node:crypto";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, webhookEndpoints } from "@zts/database";
import { encryptSecret, hashToken } from "@zts/auth";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

export const GET = createApiHandler(
  { permission: "automation.read", rateLimit: "api" },
  async () => {
    const rows = await getDb()
      .select({
        id: webhookEndpoints.id,
        name: webhookEndpoints.name,
        slug: webhookEndpoints.slug,
        enabled: webhookEndpoints.enabled,
        workflowId: webhookEndpoints.workflowId,
        createdAt: webhookEndpoints.createdAt,
      })
      .from(webhookEndpoints)
      .orderBy(desc(webhookEndpoints.createdAt));
    return jsonOk({ endpoints: rows });
  },
);

const createBodySchema = z.object({
  name: z.string().min(1).max(128),
  workflowId: z.string().uuid().optional(),
});

export const POST = createApiHandler(
  { permission: "automation.create", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const rawSecret = randomBytes(32).toString("base64url");
    const slug = randomBytes(12).toString("hex");
    const env = getEnv();
    const db = getDb();
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        name: body.name,
        slug,
        secretHash: hashToken(rawSecret),
        encryptedSecret: encryptSecret(env.SESSION_SECRET, rawSecret),
        workflowId: body.workflowId ?? null,
        createdBy: auth.user.id,
      })
      .returning();

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WEBHOOK_ENDPOINT_CREATED",
      target: row!.id,
      ip,
      userAgent,
    });

    return jsonOk(
      {
        endpoint: {
          id: row!.id,
          name: row!.name,
          slug: row!.slug,
          enabled: row!.enabled,
        },
        secret: rawSecret,
        inboundPath: `/api/webhooks/inbound/${slug}`,
      },
      { status: 201 },
    );
  },
);
