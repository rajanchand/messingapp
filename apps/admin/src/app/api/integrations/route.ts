import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, integrations, integrationSecrets } from "@zts/database";
import { INTEGRATION_TYPES, encryptIntegrationSecrets, getAdapter } from "@zts/integrations";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

export const GET = createApiHandler(
  { permission: "integrations.read", rateLimit: "api" },
  async () => {
    const rows = await getDb().select().from(integrations).orderBy(desc(integrations.updatedAt));
    return jsonOk({
      integrations: rows,
      types: INTEGRATION_TYPES,
    });
  },
);

const createBodySchema = z.object({
  type: z.enum(["slack", "github", "email", "discord", "jira", "webhook"]),
  name: z.string().min(1).max(128),
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(false),
});

export const POST = createApiHandler(
  { permission: "integrations.manage", bodySchema: createBodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    if (!getAdapter(body.type)) {
      return jsonError(400, "validation", "Unknown integration type.");
    }
    const db = getDb();
    const env = getEnv();
    const [row] = await db
      .insert(integrations)
      .values({
        type: body.type,
        name: body.name,
        config: body.config,
        enabled: body.enabled,
        status: "disconnected",
        createdBy: auth.user.id,
      })
      .returning();

    if (Object.keys(body.secrets).length > 0) {
      await db.insert(integrationSecrets).values({
        integrationId: row!.id,
        encryptedBlob: encryptIntegrationSecrets(env.SESSION_SECRET, body.secrets),
      });
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "INTEGRATION_CREATED",
      target: row!.id,
      ip,
      userAgent,
      metadata: { type: body.type, name: body.name },
    });

    return jsonOk({ integration: row }, { status: 201 });
  },
);
