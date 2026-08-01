import { eq } from "drizzle-orm";
import type { Database } from "@zts/database";
import { integrations, integrationSecrets, integrationLogs } from "@zts/database";
import { encryptSecret, decryptSecret } from "@zts/auth";
import { getAdapter, buildContext } from "./adapters/index";

export function encryptIntegrationSecrets(
  masterSecret: string,
  secrets: Record<string, string>,
): string {
  return encryptSecret(masterSecret, JSON.stringify(secrets));
}

export function decryptIntegrationSecrets(
  masterSecret: string,
  encryptedBlob: string,
): Record<string, string> {
  const raw = decryptSecret(masterSecret, encryptedBlob);
  return JSON.parse(raw) as Record<string, string>;
}

export async function executeIntegrationAction(
  db: Database,
  actionType: string,
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const masterSecret = process.env.SESSION_SECRET;
  if (!masterSecret) throw new Error("SESSION_SECRET required for integration secrets");

  const integrationId = String(config.integrationId ?? "");
  if (!integrationId) throw new Error("integrationId required");

  const [row] = await db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (!row || !row.enabled) throw new Error("Integration not found or disabled");

  const [secretRow] = await db
    .select()
    .from(integrationSecrets)
    .where(eq(integrationSecrets.integrationId, integrationId));
  const secrets = secretRow
    ? decryptIntegrationSecrets(masterSecret, secretRow.encryptedBlob)
    : {};

  const adapter = getAdapter(row.type);
  if (!adapter) throw new Error(`No adapter for type ${row.type}`);

  const operation =
    actionType === "SEND_SLACK"
      ? "send_message"
      : actionType === "SEND_EMAIL"
        ? "send_message"
        : actionType === "SEND_WEBHOOK"
          ? "send"
          : actionType;

  const result = await adapter.execute(
    buildContext(integrationId, row.config as Record<string, unknown> | null, secrets),
    operation,
    { ...payload, ...config },
  );

  await db.insert(integrationLogs).values({
    integrationId,
    level: result.ok ? "info" : "error",
    message: result.message ?? (result.ok ? "ok" : "failed"),
    metadata: { actionType, status: result.status },
  });

  await db
    .update(integrations)
    .set(
      result.ok
        ? { lastSuccessAt: new Date(), status: "connected", updatedAt: new Date() }
        : {
            lastErrorAt: new Date(),
            lastError: result.message ?? "failed",
            status: "error",
            updatedAt: new Date(),
          },
    )
    .where(eq(integrations.id, integrationId));

  if (!result.ok) throw new Error(result.message ?? "Integration action failed");
  return result.data ?? { ok: true };
}
