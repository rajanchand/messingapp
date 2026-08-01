import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb, integrations, integrationSecrets, integrationLogs } from "@zts/database";
import {
  encryptIntegrationSecrets,
  decryptIntegrationSecrets,
  getAdapter,
  buildContext,
} from "@zts/integrations";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

export const GET = createApiHandler(
  { permission: "integrations.read", rateLimit: "api" },
  async ({ params }) => {
    const id = params.id;
    if (!id) return jsonError(400, "validation", "id required");
    const db = getDb();
    const row = (await db.select().from(integrations).where(eq(integrations.id, id)).limit(1))[0];
    if (!row) return jsonError(404, "not_found", "Integration not found.");
    const logs = await db
      .select()
      .from(integrationLogs)
      .where(eq(integrationLogs.integrationId, id))
      .orderBy(desc(integrationLogs.createdAt))
      .limit(50);
    const hasSecrets = (
      await db
        .select()
        .from(integrationSecrets)
        .where(eq(integrationSecrets.integrationId, id))
        .limit(1)
    ).length > 0;
    return jsonOk({
      integration: {
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: row.enabled,
        status: row.status,
        config: row.config,
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        lastError: row.lastError,
        hasSecrets,
      },
      logs: logs.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  },
);

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.string()).optional(),
});

export const PATCH = createApiHandler(
  { permission: "integrations.manage", bodySchema: patchSchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    const id = params.id;
    if (!id) return jsonError(400, "validation", "id required");
    const env = getEnv();
    const db = getDb();
    const existing = (
      await db.select().from(integrations).where(eq(integrations.id, id)).limit(1)
    )[0];
    if (!existing) return jsonError(404, "not_found", "Integration not found.");

    const [updated] = await db
      .update(integrations)
      .set({
        name: body.name ?? existing.name,
        enabled: body.enabled ?? existing.enabled,
        config: body.config ?? existing.config,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, id))
      .returning();

    if (body.secrets && Object.keys(body.secrets).length > 0) {
      await db
        .insert(integrationSecrets)
        .values({
          integrationId: id,
          encryptedBlob: encryptIntegrationSecrets(env.SESSION_SECRET, body.secrets),
        })
        .onConflictDoUpdate({
          target: integrationSecrets.integrationId,
          set: {
            encryptedBlob: encryptIntegrationSecrets(env.SESSION_SECRET, body.secrets),
            updatedAt: new Date(),
          },
        });
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "INTEGRATION_UPDATED",
      target: id,
      ip,
      userAgent,
    });

    return jsonOk({ integration: updated });
  },
);

export const DELETE = createApiHandler(
  { permission: "integrations.manage", requireSudo: true, rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const id = params.id;
    if (!id) return jsonError(400, "validation", "id required");
    const db = getDb();
    await db.delete(integrations).where(eq(integrations.id, id));
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "INTEGRATION_DELETED",
      target: id,
      ip,
      userAgent,
    });
    return jsonOk({ status: "ok" });
  },
);

export const POST = createApiHandler(
  {
    permission: "integrations.manage",
    bodySchema: z.object({
      action: z.enum(["test", "send"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    rateLimit: "mutation",
  },
  async ({ auth, params, body, ip, userAgent }) => {
    const id = params.id;
    if (!id) return jsonError(400, "validation", "id required");
    const env = getEnv();
    const db = getDb();
    const row = (await db.select().from(integrations).where(eq(integrations.id, id)).limit(1))[0];
    if (!row) return jsonError(404, "not_found", "Integration not found.");

    const secretRow = (
      await db
        .select()
        .from(integrationSecrets)
        .where(eq(integrationSecrets.integrationId, id))
        .limit(1)
    )[0];
    const secrets = secretRow
      ? decryptIntegrationSecrets(env.SESSION_SECRET, secretRow.encryptedBlob)
      : {};

    const adapter = getAdapter(row.type);
    if (!adapter) return jsonError(400, "validation", `Unknown adapter type ${row.type}`);

    const ctx = buildContext(id, (row.config as Record<string, unknown>) ?? {}, secrets);

    try {
      const result =
        body.action === "test" && adapter.test
          ? await adapter.test(ctx)
          : await adapter.execute(ctx, "send_message", body.payload ?? { text: "ZTS test message" });

      await db
        .update(integrations)
        .set({
          lastSuccessAt: result.ok ? new Date() : row.lastSuccessAt,
          lastErrorAt: result.ok ? row.lastErrorAt : new Date(),
          lastError: result.ok ? null : (result.message ?? "failed"),
          status: result.ok ? "connected" : "error",
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, id));

      await db.insert(integrationLogs).values({
        integrationId: id,
        level: result.ok ? "info" : "error",
        message: result.message ?? (result.ok ? `${body.action} ok` : `${body.action} failed`),
      });

      await writeAuditLog(db, {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "INTEGRATION_TESTED",
        target: id,
        ip,
        userAgent,
        metadata: { action: body.action, ok: result.ok },
      });

      if (!result.ok) return jsonError(502, "integration_error", result.message ?? "failed");
      return jsonOk({ status: "ok", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Integration action failed";
      await db
        .update(integrations)
        .set({
          lastErrorAt: new Date(),
          lastError: message,
          status: "error",
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, id));
      return jsonError(502, "integration_error", message);
    }
  },
);
