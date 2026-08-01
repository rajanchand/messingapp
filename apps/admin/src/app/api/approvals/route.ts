import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, pendingApprovals } from "@zts/database";
import { hasPermission, writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import {
  APPROVAL_KINDS,
  createPendingApproval,
  decideApproval,
  expireStaleApprovals,
  listApprovals,
  cancelApproval,
  type ApprovalKind,
} from "@/lib/approvals";
import { adminUsers } from "@zts/database";

const listQuery = z.object({
  status: z
    .enum(["pending", "approved", "rejected", "executed", "cancelled", "expired", "all"])
    .default("pending"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = createApiHandler(
  { permission: "approvals.read", querySchema: listQuery, rateLimit: "api" },
  async ({ query }) => {
    const db = getDb();
    await expireStaleApprovals(db);
    const rows = await listApprovals(db, {
      status: query.status === "all" ? undefined : query.status,
      limit: query.limit,
    });

    const users = await db
      .select({ id: adminUsers.id, username: adminUsers.username })
      .from(adminUsers);
    const byId = new Map(users.map((u) => [u.id, u.username]));

    return jsonOk({
      approvals: rows.map((r) => ({
        ...r,
        requestedByUsername: byId.get(r.requestedBy) ?? null,
        reviewedByUsername: r.reviewedBy ? (byId.get(r.reviewedBy) ?? null) : null,
      })),
    });
  },
);

const createBody = z.object({
  kind: z.enum(APPROVAL_KINDS),
  userIds: z.array(z.string().min(1).max(255)).min(1).max(200),
  erase: z.boolean().default(false),
  reason: z.string().max(1000).optional(),
  summary: z.string().max(500).optional(),
});

export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema: createBody, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const kind = body.kind as ApprovalKind;
    if (
      (kind === "USER_ERASE" || kind === "MASS_ERASE" || body.erase) &&
      !hasPermission(auth.permissions, "users.delete")
    ) {
      return jsonError(403, "forbidden", "Erase requests require users.delete.");
    }
    if (kind === "USER_ERASE" && body.userIds.length !== 1) {
      return jsonError(400, "validation", "USER_ERASE requires exactly one userId.");
    }
    if ((kind === "MASS_DEACTIVATE" || kind === "MASS_ERASE") && body.userIds.length < 2) {
      return jsonError(400, "validation", "Mass operations require at least two users.");
    }

    const summary =
      body.summary ??
      `${kind}: ${body.userIds.length} user(s)${body.erase || kind.includes("ERASE") ? " (erase)" : ""}`;

    const row = await createPendingApproval(getDb(), {
      kind,
      summary,
      payload: {
        userIds: body.userIds,
        erase: body.erase || kind.includes("ERASE"),
        reason: body.reason,
      },
      reason: body.reason,
      requestedBy: auth.user.id,
    });

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "APPROVAL_REQUESTED",
      target: row.id,
      ip,
      userAgent,
      metadata: { kind, userCount: body.userIds.length },
    });

    return jsonOk({ approval: row }, { status: 201 });
  },
);

const decideBody = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "cancel"]),
  reviewNote: z.string().max(1000).optional(),
});

export const PATCH = createApiHandler(
  {
    permission: "approvals.read",
    requireSudo: true,
    bodySchema: decideBody,
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();

    if (body.decision === "cancel") {
      const cancelled = await cancelApproval(db, body.approvalId, auth.user.id);
      if (!cancelled) {
        return jsonError(404, "not_found", "Pending approval not found or not owned by you.");
      }
      await writeAuditLog(db, {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "APPROVAL_CANCELLED",
        target: body.approvalId,
        ip,
        userAgent,
      });
      return jsonOk({ approval: cancelled });
    }

    if (!hasPermission(auth.permissions, "approvals.manage")) {
      return jsonError(403, "forbidden", "Approving or rejecting requires approvals.manage.");
    }

    const [existing] = await db
      .select()
      .from(pendingApprovals)
      .where(eq(pendingApprovals.id, body.approvalId))
      .limit(1);
    if (!existing) return jsonError(404, "not_found", "Approval not found.");
    if (
      (existing.kind === "USER_ERASE" || existing.kind === "MASS_ERASE") &&
      !hasPermission(auth.permissions, "users.delete")
    ) {
      return jsonError(403, "forbidden", "Approving erase requires users.delete.");
    }

    const result = await decideApproval(db, {
      approvalId: body.approvalId,
      reviewerId: auth.user.id,
      reviewerUsername: auth.user.username,
      decision: body.decision,
      reviewNote: body.reviewNote,
      ip,
      userAgent,
    });

    switch (result.status) {
      case "not_found":
        return jsonError(404, "not_found", "Approval not found.");
      case "not_pending":
        return jsonError(409, "conflict", "Approval is no longer pending.");
      case "same_actor":
        return jsonError(403, "forbidden", "A different admin must approve this request.");
      case "expired":
        return jsonError(410, "gone", "Approval request has expired.");
      case "exec_failed":
        return jsonError(500, "exec_failed", result.error ?? "Execution failed after approval.");
      default:
        return jsonOk({
          approval: result.row,
          result: "result" in result ? result.result : undefined,
        });
    }
  },
);
