import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  pendingApprovals,
  notifications,
  adminUsers,
  type Database,
} from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";

export const APPROVAL_KINDS = [
  "USER_ERASE",
  "MASS_DEACTIVATE",
  "MASS_ERASE",
  "BULK_DEVICE_REVOKE",
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ApprovalPayload {
  userIds: string[];
  erase?: boolean;
  reason?: string;
}

function asPayload(raw: unknown): ApprovalPayload {
  const p = (raw ?? {}) as ApprovalPayload;
  return {
    userIds: Array.isArray(p.userIds) ? p.userIds.map(String) : [],
    erase: Boolean(p.erase),
    reason: p.reason ? String(p.reason) : undefined,
  };
}

export async function createPendingApproval(
  db: Database,
  input: {
    kind: ApprovalKind;
    summary: string;
    payload: ApprovalPayload;
    reason?: string;
    requestedBy: string;
  },
) {
  const [row] = await db
    .insert(pendingApprovals)
    .values({
      kind: input.kind,
      status: "pending",
      summary: input.summary,
      payload: input.payload,
      reason: input.reason ?? null,
      requestedBy: input.requestedBy,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    })
    .returning();

  // Notify other admins about the pending request.
  const admins = await db.select({ id: adminUsers.id }).from(adminUsers);
  for (const a of admins) {
    if (a.id === input.requestedBy) continue;
    await db.insert(notifications).values({
      userId: a.id,
      type: "approval",
      title: "Dual-approval required",
      body: input.summary.slice(0, 500),
      href: "/approvals",
      metadata: { approvalId: row?.id, kind: input.kind },
    });
  }

  return row!;
}

async function executeApproval(
  db: Database,
  kind: ApprovalKind,
  payload: ApprovalPayload,
  actor: string,
): Promise<{ ok: number; failed: { userId: string; error: string }[] }> {
  const synapse = getSynapseClient();
  const failed: { userId: string; error: string }[] = [];
  let ok = 0;

  for (const userId of payload.userIds) {
    try {
      if (kind === "BULK_DEVICE_REVOKE") {
        await synapse.logoutAllDevices(userId);
      } else {
        const erase = kind === "USER_ERASE" || kind === "MASS_ERASE" || Boolean(payload.erase);
        await synapse.deactivateUser(userId, erase);
      }
      ok += 1;
    } catch (err) {
      failed.push({
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeAuditLog(db, {
    actor,
    action: `APPROVAL_EXECUTED_${kind}`,
    target: payload.userIds.slice(0, 5).join(","),
    metadata: {
      ok,
      failedCount: failed.length,
      userCount: payload.userIds.length,
      erase: payload.erase,
    },
  });

  return { ok, failed };
}

export async function decideApproval(
  db: Database,
  input: {
    approvalId: string;
    reviewerId: string;
    reviewerUsername: string;
    decision: "approve" | "reject";
    reviewNote?: string;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  const [row] = await db
    .select()
    .from(pendingApprovals)
    .where(eq(pendingApprovals.id, input.approvalId))
    .limit(1);

  if (!row) return { status: "not_found" as const };
  if (row.status !== "pending") return { status: "not_pending" as const, row };
  if (row.requestedBy === input.reviewerId) {
    return { status: "same_actor" as const, row };
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await db
      .update(pendingApprovals)
      .set({ status: "expired" })
      .where(eq(pendingApprovals.id, row.id));
    return { status: "expired" as const, row };
  }

  if (input.decision === "reject") {
    const [updated] = await db
      .update(pendingApprovals)
      .set({
        status: "rejected",
        reviewedBy: input.reviewerId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
      })
      .where(eq(pendingApprovals.id, row.id))
      .returning();

    await writeAuditLog(db, {
      actorId: input.reviewerId,
      actor: input.reviewerUsername,
      action: "APPROVAL_REJECTED",
      target: row.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { kind: row.kind, note: input.reviewNote },
    });

    await db.insert(notifications).values({
      userId: row.requestedBy,
      type: "approval",
      title: "Approval rejected",
      body: row.summary.slice(0, 500),
      href: "/approvals",
      metadata: { approvalId: row.id },
    });

    return { status: "rejected" as const, row: updated! };
  }

  // Approve + execute
  const payload = asPayload(row.payload);
  let execResult: { ok: number; failed: { userId: string; error: string }[] };
  try {
    execResult = await executeApproval(db, row.kind as ApprovalKind, payload, input.reviewerUsername);
  } catch (err) {
    const [updated] = await db
      .update(pendingApprovals)
      .set({
        status: "approved",
        reviewedBy: input.reviewerId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(pendingApprovals.id, row.id))
      .returning();
    return { status: "exec_failed" as const, row: updated!, error: String(err) };
  }

  const [updated] = await db
    .update(pendingApprovals)
    .set({
      status: "executed",
      reviewedBy: input.reviewerId,
      reviewedAt: new Date(),
      executedAt: new Date(),
      reviewNote: input.reviewNote ?? null,
      error:
        execResult.failed.length > 0
          ? `${execResult.failed.length} failed: ${execResult.failed
              .slice(0, 3)
              .map((f) => f.userId)
              .join(", ")}`
          : null,
    })
    .where(eq(pendingApprovals.id, row.id))
    .returning();

  await writeAuditLog(db, {
    actorId: input.reviewerId,
    actor: input.reviewerUsername,
    action: "APPROVAL_APPROVED",
    target: row.id,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: { kind: row.kind, ...execResult },
  });

  await db.insert(notifications).values({
    userId: row.requestedBy,
    type: "approval",
    title: "Approval executed",
    body: `${row.summary} — ${execResult.ok} ok, ${execResult.failed.length} failed`,
    href: "/approvals",
    metadata: { approvalId: row.id },
  });

  return { status: "executed" as const, row: updated!, result: execResult };
}

export async function listApprovals(
  db: Database,
  opts: { status?: string; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  if (opts.status) {
    return db
      .select()
      .from(pendingApprovals)
      .where(eq(pendingApprovals.status, opts.status))
      .orderBy(desc(pendingApprovals.createdAt))
      .limit(limit);
  }
  return db.select().from(pendingApprovals).orderBy(desc(pendingApprovals.createdAt)).limit(limit);
}

export async function cancelApproval(
  db: Database,
  approvalId: string,
  actorId: string,
) {
  const [row] = await db
    .select()
    .from(pendingApprovals)
    .where(and(eq(pendingApprovals.id, approvalId), eq(pendingApprovals.status, "pending")))
    .limit(1);
  if (!row) return null;
  if (row.requestedBy !== actorId) return null;
  const [updated] = await db
    .update(pendingApprovals)
    .set({ status: "cancelled" })
    .where(eq(pendingApprovals.id, approvalId))
    .returning();
  return updated ?? null;
}

/** Expire stale pending rows (best-effort, called from list). */
export async function expireStaleApprovals(db: Database) {
  const pending = await db
    .select({ id: pendingApprovals.id, expiresAt: pendingApprovals.expiresAt })
    .from(pendingApprovals)
    .where(eq(pendingApprovals.status, "pending"));
  const now = Date.now();
  const ids = pending.filter((p) => p.expiresAt && p.expiresAt.getTime() < now).map((p) => p.id);
  if (ids.length === 0) return;
  await db
    .update(pendingApprovals)
    .set({ status: "expired" })
    .where(inArray(pendingApprovals.id, ids));
}
