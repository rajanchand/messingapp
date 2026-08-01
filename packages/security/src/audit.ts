import type { Database } from "@zts/database";
import { auditLogs, securityEvents } from "@zts/database";

export interface AuditEntry {
  actorId?: string | null;
  /** Human-readable actor identifier, e.g. username or Matrix ID. */
  actor: string;
  /** e.g. "USER_CREATED", "USER_DEACTIVATED", "PASSWORD_RESET" */
  action: string;
  target?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  result?: "success" | "failure";
  metadata?: Record<string, unknown>;
}

/** Keys that must never appear in audit metadata. */
const FORBIDDEN_KEYS = /pass(word)?|token|secret|key|credential|cookie|authorization/i;

export function redactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactMetadata(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Appends an audit log entry. Metadata is defensively redacted so that
 * passwords, tokens and secrets can never be persisted even if a caller
 * passes them by mistake. Audit writes never throw - a failed audit write
 * is logged but must not break the underlying admin operation.
 */
export async function writeAuditLog(db: Database, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      result: entry.result ?? "success",
      metadata: entry.metadata ? redactMetadata(entry.metadata) : null,
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err);
  }
}

export interface SecurityEventEntry {
  type: string;
  severity?: "info" | "warning" | "critical";
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeSecurityEvent(db: Database, entry: SecurityEventEntry): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      type: entry.type,
      severity: entry.severity ?? "info",
      userId: entry.userId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.metadata ? redactMetadata(entry.metadata) : null,
    });
  } catch (err) {
    console.error("[security] failed to write security event:", err);
  }
}
