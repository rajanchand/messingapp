import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, appSettings } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

export const HOMESERVER_POLICY_KEY = "homeserver_policy";

export interface PanelHomeserverPolicy {
  /** Operator intent — must be synced to homeserver.yaml for real Synapse. */
  registrationEnabled: boolean;
  federationEnabled: boolean;
  guestsAllowed: boolean;
  publicRoomDirectoryEnabled: boolean;
  messagesPerSecond: number | null;
  registrationPerSecond: number | null;
  loginPerSecond: number | null;
  notes: string;
}

const DEFAULT_POLICY: PanelHomeserverPolicy = {
  registrationEnabled: false,
  federationEnabled: true,
  guestsAllowed: false,
  publicRoomDirectoryEnabled: true,
  messagesPerSecond: null,
  registrationPerSecond: null,
  loginPerSecond: null,
  notes: "",
};

export const GET = createApiHandler(
  { permission: "settings.read", rateLimit: "api" },
  async () => {
    const synapse = getSynapseClient();
    const live = await synapse.getHomeserverPolicy();

    const [row] = await getDb()
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, HOMESERVER_POLICY_KEY))
      .limit(1);
    const panel: PanelHomeserverPolicy = {
      ...DEFAULT_POLICY,
      ...((row?.value as Partial<PanelHomeserverPolicy>) ?? {}),
    };

    return jsonOk({
      live,
      panel,
      /** Synapse cannot apply most toggles remotely — panel stores intent only. */
      mutableRemotely: live.source === "mock",
      guidance:
        live.source === "mock"
          ? "Mock Synapse accepts panel policy writes for local testing."
          : "Real Synapse Admin API does not expose homeserver.yaml. Save panel preferences and sync them in Synapse config / reload.",
    });
  },
);

const patchBody = z.object({
  registrationEnabled: z.boolean().optional(),
  federationEnabled: z.boolean().optional(),
  guestsAllowed: z.boolean().optional(),
  publicRoomDirectoryEnabled: z.boolean().optional(),
  messagesPerSecond: z.number().int().min(0).max(10_000).nullable().optional(),
  registrationPerSecond: z.number().int().min(0).max(1000).nullable().optional(),
  loginPerSecond: z.number().int().min(0).max(1000).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export const PATCH = createApiHandler(
  { permission: "settings.manage", requireSudo: true, bodySchema: patchBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, HOMESERVER_POLICY_KEY))
      .limit(1);
    const current: PanelHomeserverPolicy = {
      ...DEFAULT_POLICY,
      ...((existing?.value as Partial<PanelHomeserverPolicy>) ?? {}),
    };
    const next: PanelHomeserverPolicy = {
      ...current,
      ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    };

    await db
      .insert(appSettings)
      .values({ key: HOMESERVER_POLICY_KEY, value: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: next, updatedAt: new Date() },
      });

    // Best-effort push to mock Synapse policy endpoint.
    try {
      await getSynapseClient().putHomeserverPolicy({
        registration_enabled: next.registrationEnabled,
        federation_enabled: next.federationEnabled,
        guests_allowed: next.guestsAllowed,
        public_room_directory_enabled: next.publicRoomDirectoryEnabled,
        rate_limits: {
          messages_per_second: next.messagesPerSecond ?? undefined,
          registration_per_second: next.registrationPerSecond ?? undefined,
          login_per_second: next.loginPerSecond ?? undefined,
          notes: next.notes || undefined,
        },
      });
    } catch {
      // Expected on real Synapse (404 / unrecognized).
    }

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "HOMESERVER_POLICY_UPDATED",
      target: HOMESERVER_POLICY_KEY,
      ip,
      userAgent,
      metadata: { panel: next },
    });

    return jsonOk({ panel: next });
  },
);
