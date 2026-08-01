import { z } from "zod";
import {
  DEFAULT_ANOMALY_SETTINGS,
  getAnomalySettings,
  saveAnomalySettings,
  type AnomalySettings,
} from "@/lib/anomaly";
import { getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

export const GET = createApiHandler(
  { permission: "security.read", rateLimit: "api" },
  async () => {
    const settings = await getAnomalySettings();
    return jsonOk({
      settings,
      defaults: DEFAULT_ANOMALY_SETTINGS,
      catalogTriggers: ["LOGIN_BURST_FAILURES", "NEW_DEVICE_SEEN"],
      catalogActions: ["NOTIFY_ADMIN", "BLOCK_IP"],
    });
  },
);

const patchBody = z.object({
  enabled: z.boolean().optional(),
  burstFailureThreshold: z.number().int().min(2).max(100).optional(),
  burstWindowMinutes: z.number().int().min(1).max(1440).optional(),
  autoBlockEnabled: z.boolean().optional(),
  autoBlockTtlMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  notifyAdmins: z.boolean().optional(),
});

export const PATCH = createApiHandler(
  { permission: "security.manage", requireSudo: true, bodySchema: patchBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const current = await getAnomalySettings();
    const next: AnomalySettings = { ...current, ...body };
    await saveAnomalySettings(next);
    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "ANOMALY_SETTINGS_UPDATED",
      target: "anomaly_engine",
      ip,
      userAgent,
      metadata: { settings: next },
    });
    return jsonOk({ settings: next });
  },
);
