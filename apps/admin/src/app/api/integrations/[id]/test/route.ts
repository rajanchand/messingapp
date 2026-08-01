import { eq } from "drizzle-orm";
import { getDb, integrations, integrationSecrets, integrationLogs } from "@zts/database";
import { getAdapter, buildContext, decryptIntegrationSecrets } from "@zts/integrations";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

export const POST = createApiHandler(
  { permission: "integrations.manage", rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const db = getDb();
    const env = getEnv();
    const [row] = await db.select().from(integrations).where(eq(integrations.id, params.id!));
    if (!row) return jsonError(404, "not_found", "Integration not found.");
    const adapter = getAdapter(row.type);
    if (!adapter) return jsonError(400, "validation", "Unknown adapter.");

    const [secretRow] = await db
      .select()
      .from(integrationSecrets)
      .where(eq(integrationSecrets.integrationId, row.id));
    const secrets = secretRow
      ? decryptIntegrationSecrets(env.SESSION_SECRET, secretRow.encryptedBlob)
      : {};
    const ctx = buildContext(row.id, row.config as Record<string, unknown> | null, secrets);

    const result = adapter.test
      ? await adapter.test(ctx)
      : await adapter.execute(ctx, "test", {});

    await db.insert(integrationLogs).values({
      integrationId: row.id,
      level: result.ok ? "info" : "error",
      message: result.message ?? (result.ok ? "Test ok" : "Test failed"),
    });
    await db
      .update(integrations)
      .set(
        result.ok
          ? { status: "connected", lastSuccessAt: new Date(), updatedAt: new Date() }
          : {
              status: "error",
              lastErrorAt: new Date(),
              lastError: result.message ?? "test failed",
              updatedAt: new Date(),
            },
      )
      .where(eq(integrations.id, row.id));

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "INTEGRATION_TESTED",
      target: row.id,
      ip,
      userAgent,
      metadata: { ok: result.ok },
    });

    return jsonOk({ result });
  },
);
