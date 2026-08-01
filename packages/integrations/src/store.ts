import type { Database } from "@zts/database";
import {
  integrationLogs,
  integrationSecrets,
  integrations,
} from "@zts/database";
import { eq } from "drizzle-orm";
import { decryptIntegrationSecrets, encryptIntegrationSecrets } from "./secrets";
import { getAdapter } from "./registry";
import type { IntegrationAdapter } from "./types";

/** Keys that must never appear in integration log metadata. */
const FORBIDDEN_KEYS = /pass(word)?|token|secret|key|credential|cookie|authorization|pat|webhook/i;

export function redactLogMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactLogMetadata(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface CreateIntegrationInput {
  type: string;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  createdBy?: string | null;
}

export async function createIntegration(db: Database, input: CreateIntegrationInput) {
  const [row] = await db
    .insert(integrations)
    .values({
      type: input.type,
      name: input.name,
      config: input.config ?? null,
      enabled: input.enabled ?? false,
      status: "disconnected",
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create integration");
  }
  return row;
}

export async function getIntegrationById(db: Database, id: string) {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
  return row ?? null;
}

export async function listIntegrations(db: Database) {
  return db.select().from(integrations).orderBy(integrations.createdAt);
}

export async function updateIntegrationConfig(
  db: Database,
  id: string,
  config: Record<string, unknown>,
) {
  const [row] = await db
    .update(integrations)
    .set({ config, updatedAt: new Date() })
    .where(eq(integrations.id, id))
    .returning();
  return row ?? null;
}

export async function setIntegrationEnabled(db: Database, id: string, enabled: boolean) {
  const [row] = await db
    .update(integrations)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(integrations.id, id))
    .returning();
  return row ?? null;
}

export async function setIntegrationStatus(
  db: Database,
  id: string,
  status: string,
  opts: { lastError?: string | null; success?: boolean } = {},
) {
  const now = new Date();
  const [row] = await db
    .update(integrations)
    .set({
      status,
      lastError: opts.lastError ?? null,
      lastSuccessAt: opts.success ? now : undefined,
      lastErrorAt: opts.lastError ? now : undefined,
      updatedAt: now,
    })
    .where(eq(integrations.id, id))
    .returning();
  return row ?? null;
}

export async function saveIntegrationSecrets(
  db: Database,
  sessionSecret: string,
  integrationId: string,
  secrets: Record<string, string>,
) {
  const encryptedBlob = encryptIntegrationSecrets(sessionSecret, secrets);
  const [row] = await db
    .insert(integrationSecrets)
    .values({ integrationId, encryptedBlob })
    .onConflictDoUpdate({
      target: integrationSecrets.integrationId,
      set: { encryptedBlob, updatedAt: new Date() },
    })
    .returning();
  return row ?? null;
}

export async function loadIntegrationSecrets(
  db: Database,
  sessionSecret: string,
  integrationId: string,
): Promise<Record<string, string> | null> {
  const [row] = await db
    .select()
    .from(integrationSecrets)
    .where(eq(integrationSecrets.integrationId, integrationId))
    .limit(1);
  if (!row) return null;
  return decryptIntegrationSecrets(sessionSecret, row.encryptedBlob);
}

export async function deleteIntegrationSecrets(db: Database, integrationId: string) {
  await db.delete(integrationSecrets).where(eq(integrationSecrets.integrationId, integrationId));
}

export async function appendIntegrationLog(
  db: Database,
  integrationId: string,
  level: "info" | "warning" | "error",
  message: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await db.insert(integrationLogs).values({
      integrationId,
      level,
      message,
      metadata: metadata ? redactLogMetadata(metadata) : null,
    });
  } catch (err) {
    console.error("[integrations] failed to write integration log:", err);
  }
}

export async function listIntegrationLogs(db: Database, integrationId: string, limit = 50) {
  return db
    .select()
    .from(integrationLogs)
    .where(eq(integrationLogs.integrationId, integrationId))
    .orderBy(integrationLogs.createdAt)
    .limit(limit);
}

/** Loads a stored integration, decrypts secrets, and connects its adapter. */
export async function connectStoredIntegration(
  db: Database,
  sessionSecret: string,
  integrationId: string,
): Promise<IntegrationAdapter> {
  const integration = await getIntegrationById(db, integrationId);
  if (!integration) {
    throw new Error("Integration not found");
  }

  const secrets = (await loadIntegrationSecrets(db, sessionSecret, integrationId)) ?? {};
  const adapter = getAdapter(integration.type);
  await adapter.connect((integration.config as Record<string, unknown> | null) ?? {}, secrets);
  await setIntegrationStatus(db, integrationId, "connected");
  await appendIntegrationLog(db, integrationId, "info", "Integration connected");
  return adapter;
}

/** Tests a stored integration and updates its status. */
export async function testStoredIntegration(
  db: Database,
  sessionSecret: string,
  integrationId: string,
): Promise<{ ok: boolean; message: string }> {
  const adapter = await connectStoredIntegration(db, sessionSecret, integrationId);
  try {
    const result = await adapter.test();
    await setIntegrationStatus(db, integrationId, result.ok ? "connected" : "error", {
      lastError: result.ok ? null : result.message,
      success: result.ok,
    });
    await appendIntegrationLog(db, integrationId, result.ok ? "info" : "error", result.message);
    return result;
  } finally {
    await adapter.disconnect();
  }
}

/** Sends a payload through a stored integration. */
export async function sendViaStoredIntegration(
  db: Database,
  sessionSecret: string,
  integrationId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; message?: string }> {
  const integration = await getIntegrationById(db, integrationId);
  if (!integration?.enabled) {
    return { ok: false, message: "Integration is disabled or not found" };
  }

  const adapter = await connectStoredIntegration(db, sessionSecret, integrationId);
  try {
    const result = await adapter.send(payload);
    await setIntegrationStatus(db, integrationId, result.ok ? "connected" : "error", {
      lastError: result.ok ? null : (result.message ?? "Send failed"),
      success: result.ok,
    });
    await appendIntegrationLog(
      db,
      integrationId,
      result.ok ? "info" : "error",
      result.ok ? "Payload sent" : (result.message ?? "Send failed"),
      { event: payload.event },
    );
    return result;
  } finally {
    await adapter.disconnect();
  }
}
