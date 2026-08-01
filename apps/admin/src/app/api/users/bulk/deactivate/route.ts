import { z } from "zod";
import { getDb } from "@zts/database";
import { hasPermission, writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { createPendingApproval } from "@/lib/approvals";

const bodySchema = z.object({
  userIds: z.array(z.string().min(1).max(255)).min(2).max(200),
  erase: z.boolean().default(false),
  reason: z.string().max(1000).optional(),
});

/**
 * Mass deactivate / erase — always dual-approval. Creates a pending request;
 * a second admin must approve (with sudo) before Synapse is mutated.
 */
export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    if (body.erase && !hasPermission(auth.permissions, "users.delete")) {
      return jsonError(403, "forbidden", "Mass erase requires users.delete.");
    }

    const kind = body.erase ? "MASS_ERASE" : "MASS_DEACTIVATE";
    const summary = `${kind}: ${body.userIds.length} users${body.reason ? ` — ${body.reason}` : ""}`;

    const approval = await createPendingApproval(getDb(), {
      kind,
      summary,
      payload: { userIds: body.userIds, erase: body.erase, reason: body.reason },
      reason: body.reason,
      requestedBy: auth.user.id,
    });

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "BULK_DEACTIVATE_REQUESTED",
      target: `${body.userIds.length} users`,
      ip,
      userAgent,
      metadata: { approvalId: approval.id, erase: body.erase },
    });

    return jsonOk(
      {
        status: "pending_approval" as const,
        approvalId: approval.id,
        message: "Awaiting second-admin approval before deactivation.",
      },
      { status: 202 },
    );
  },
);
