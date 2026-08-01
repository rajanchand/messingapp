import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { createPendingApproval } from "@/lib/approvals";

const bodySchema = z.object({
  userIds: z.array(z.string().min(1).max(255)).min(1).max(200),
  reason: z.string().max(1000).optional(),
  /** When true (or ≥5 users), queue dual-approval instead of immediate revoke. */
  requireApproval: z.boolean().optional(),
});

/**
 * Bulk logout-all / device revoke. Small batches execute immediately under sudo;
 * large batches (≥5) or explicit requireApproval go through dual-control.
 */
export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, body, ip, userAgent }) => {
    const needsApproval = body.requireApproval === true || body.userIds.length >= 5;

    if (needsApproval) {
      const approval = await createPendingApproval(getDb(), {
        kind: "BULK_DEVICE_REVOKE",
        summary: `BULK_DEVICE_REVOKE: ${body.userIds.length} users`,
        payload: { userIds: body.userIds, reason: body.reason },
        reason: body.reason,
        requestedBy: auth.user.id,
      });
      await writeAuditLog(getDb(), {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "BULK_DEVICE_REVOKE_REQUESTED",
        target: `${body.userIds.length} users`,
        ip,
        userAgent,
        metadata: { approvalId: approval.id },
      });
      return jsonOk(
        {
          status: "pending_approval" as const,
          approvalId: approval.id,
        },
        { status: 202 },
      );
    }

    const synapse = getSynapseClient();
    const results: { userId: string; devicesRevoked: number; error?: string }[] = [];
    for (const userId of body.userIds) {
      try {
        const n = await synapse.logoutAllDevices(userId);
        results.push({ userId, devicesRevoked: n });
      } catch (err) {
        results.push({
          userId,
          devicesRevoked: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "BULK_DEVICE_REVOKE",
      target: `${body.userIds.length} users`,
      ip,
      userAgent,
      metadata: {
        ok: results.filter((r) => !r.error).length,
        failed: results.filter((r) => r.error).length,
      },
    });

    return jsonOk({ status: "ok" as const, results });
  },
);
