import { randomBytes } from "node:crypto";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, webhookEndpoints, webhookDeliveries } from "@zts/database";
import { encryptSecret, hashToken } from "@zts/auth";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

export const GET = createApiHandler(
  { permission: "automation.read", rateLimit: "api" },
  async () => {
    const db = getDb();
    const endpoints = await db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return jsonOk({
      endpoints: endpoints.map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug,
        enabled: e.enabled,
        workflowId: e.workflowId,
        createdAt: e.createdAt.toISOString(),
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        endpointId: d.endpointId,
        direction: d.direction,
        status: d.status,
        httpStatus: d.httpStatus,
        error: d.error,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  },
);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  workflowId: z.string().uuid().optional(),
});

export const POST = createApiHandler(
  { permission: "automation.create", bodySchema: createSchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const env = getEnv();
    const rawSecret = randomBytes(32).toString("base64url");
    const slug = randomBytes(12).toString("hex");
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
          workflowId: row!.workflowId,
        },
        /** Shown once — store securely. */
        secret: rawSecret,
        inboundPath: `/api/webhooks/inbound/${row!.slug}`,
      },
      { status: 201 },
    );
  },
);

export const DELETE = createApiHandler(
  {
    permission: "automation.delete",
    requireSudo: true,
    bodySchema: z.object({ id: z.string().uuid() }),
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const existing = (
      await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, body.id)).limit(1)
    )[0];
    if (!existing) return jsonError(404, "not_found", "Endpoint not found.");
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, body.id));
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WEBHOOK_ENDPOINT_DELETED",
      target: body.id,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" });
  },
);
