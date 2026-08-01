import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  getDb,
  appSettings,
  ipBlocks,
  ipAllowlist,
  loginAttempts,
  notifications,
  adminUsers,
  securityEvents,
} from "@zts/database";
import { isIpInCidr, writeAuditLog, writeSecurityEvent } from "@zts/security";
import { emitTrigger } from "@/lib/automation/emit";

export const ANOMALY_SETTINGS_KEY = "anomaly_engine";

export interface AnomalySettings {
  /** Enable burst-failure detection + triggers. */
  enabled: boolean;
  /** Failed logins from same IP within window to fire LOGIN_BURST_FAILURES. */
  burstFailureThreshold: number;
  /** Window in minutes for burst detection. */
  burstWindowMinutes: number;
  /** When true, automatically insert an IP block on burst (still audited). */
  autoBlockEnabled: boolean;
  /** Auto-block TTL in minutes (0 = no expiry). */
  autoBlockTtlMinutes: number;
  /** Notify panel admins on burst / new device. */
  notifyAdmins: boolean;
}

export const DEFAULT_ANOMALY_SETTINGS: AnomalySettings = {
  enabled: true,
  burstFailureThreshold: 5,
  burstWindowMinutes: 15,
  autoBlockEnabled: false,
  autoBlockTtlMinutes: 60,
  notifyAdmins: true,
};

export async function getAnomalySettings(): Promise<AnomalySettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, ANOMALY_SETTINGS_KEY))
    .limit(1);
  if (!row?.value || typeof row.value !== "object") return { ...DEFAULT_ANOMALY_SETTINGS };
  return { ...DEFAULT_ANOMALY_SETTINGS, ...(row.value as Partial<AnomalySettings>) };
}

export async function saveAnomalySettings(settings: AnomalySettings): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({
      key: ANOMALY_SETTINGS_KEY,
      value: settings,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: settings, updatedAt: new Date() },
    });
}

async function isAllowlisted(ip: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select({ cidr: ipAllowlist.cidr }).from(ipAllowlist);
  return rows.some((r) => isIpInCidr(ip, r.cidr));
}

async function notifySecurityAdmins(title: string, body: string, metadata?: Record<string, unknown>) {
  const db = getDb();
  const admins = await db.select({ id: adminUsers.id }).from(adminUsers);
  for (const a of admins) {
    await db.insert(notifications).values({
      userId: a.id,
      type: "security",
      title,
      body: body.slice(0, 2000),
      href: "/security",
      metadata: metadata ?? null,
    });
  }
}

/**
 * Called after a failed admin-panel login. Counts recent failures for the IP,
 * emits LOGIN_BURST_FAILURES, optionally auto-blocks, and notifies admins.
 */
export async function evaluateLoginBurst(opts: {
  ip: string | null;
  username: string;
}): Promise<{ triggered: boolean; failures: number; blocked: boolean }> {
  const settings = await getAnomalySettings();
  if (!settings.enabled || !opts.ip) {
    return { triggered: false, failures: 0, blocked: false };
  }

  const db = getDb();
  const since = new Date(Date.now() - settings.burstWindowMinutes * 60_000);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.success, false),
        eq(loginAttempts.ip, opts.ip),
        gte(loginAttempts.createdAt, since),
      ),
    );

  const failures = Number(countRows[0]?.count ?? 0);
  if (failures < settings.burstFailureThreshold) {
    return { triggered: false, failures, blocked: false };
  }

  emitTrigger("LOGIN_BURST_FAILURES", {
    ip: opts.ip,
    username: opts.username,
    failures,
    windowMinutes: settings.burstWindowMinutes,
  });

  await writeSecurityEvent(db, {
    type: "LOGIN_BURST_DETECTED",
    severity: "warning",
    ip: opts.ip,
    metadata: {
      username: opts.username,
      failures,
      windowMinutes: settings.burstWindowMinutes,
    },
  });

  if (settings.notifyAdmins) {
    await notifySecurityAdmins(
      "Login burst failures",
      `${failures} failed logins from ${opts.ip} in ${settings.burstWindowMinutes}m (latest user: ${opts.username})`,
      { ip: opts.ip, failures },
    );
  }

  let blocked = false;
  if (settings.autoBlockEnabled) {
    const allowlisted = await isAllowlisted(opts.ip);
    if (!allowlisted) {
      const expiresAt =
        settings.autoBlockTtlMinutes > 0
          ? new Date(Date.now() + settings.autoBlockTtlMinutes * 60_000)
          : null;
      try {
        await db
          .insert(ipBlocks)
          .values({
            cidr: opts.ip,
            reason: `Auto-block: ${failures} failed logins in ${settings.burstWindowMinutes}m`,
            expiresAt,
          })
          .onConflictDoNothing();
        blocked = true;
        await writeAuditLog(db, {
          actor: "anomaly-engine",
          action: "IP_AUTO_BLOCKED",
          target: opts.ip,
          metadata: { failures, username: opts.username },
        });
        await db.insert(securityEvents).values({
          type: "IP_AUTO_BLOCKED",
          severity: "critical",
          ip: opts.ip,
          metadata: { failures, username: opts.username },
        });
      } catch {
        // Race / duplicate — ignore.
      }
    }
  }

  return { triggered: true, failures, blocked };
}

/**
 * Emit NEW_DEVICE_SEEN when a Matrix user's device inventory gains a device
 * that was not in the previous snapshot (caller supplies before/after ids).
 */
export async function evaluateNewDevices(opts: {
  userId: string;
  previousDeviceIds: string[];
  currentDeviceIds: string[];
  ip?: string | null;
}): Promise<string[]> {
  const settings = await getAnomalySettings();
  if (!settings.enabled) return [];

  const prev = new Set(opts.previousDeviceIds);
  const novel = opts.currentDeviceIds.filter((id) => !prev.has(id));
  for (const deviceId of novel) {
    emitTrigger("NEW_DEVICE_SEEN", {
      userId: opts.userId,
      deviceId,
      ip: opts.ip ?? null,
    });
    if (settings.notifyAdmins) {
      await notifySecurityAdmins(
        "New Matrix device seen",
        `User ${opts.userId} has new device ${deviceId}`,
        { userId: opts.userId, deviceId },
      );
    }
    await writeSecurityEvent(getDb(), {
      type: "NEW_DEVICE_SEEN",
      severity: "info",
      ip: opts.ip ?? null,
      metadata: { userId: opts.userId, deviceId },
    });
  }
  return novel;
}
