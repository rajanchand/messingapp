import { z } from "zod";
import { getDb } from "@zts/database";
import { getSynapseClient } from "@zts/matrix";
import { hasPermission, writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { requireMatrixUserId } from "@/lib/api/matrix-helpers";
import { createPendingApproval } from "@/lib/approvals";

const bodySchema = z.object({
  /** GDPR-style erasure of profile and message metadata. Irreversible. */
  erase: z.boolean().default(false),
  /**
   * When true (default for erase), queue dual-approval instead of immediate erase.
   * Non-erase deactivate still executes immediately under sudo.
   */
  requireApproval: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});

/**
 * Deactivate a user. Plain deactivate runs immediately (sudo).
 * GDPR erase always requires a second admin via the dual-approval queue.
 */
export const POST = createApiHandler(
  { permission: "users.disable", requireSudo: true, bodySchema, rateLimit: "mutation" },
  async ({ auth, params, body, ip, userAgent }) => {
    if (body.erase && !hasPermission(auth.permissions, "users.delete")) {
      return jsonError(
        403,
        "forbidden",
        "Permanently erasing user data requires the users.delete permission.",
      );
    }

    const userId = requireMatrixUserId(params);

    // Erase always goes through dual-approval (break-glass).
    const needsApproval = body.erase || body.requireApproval === true;
    if (needsApproval) {
      const approval = await createPendingApproval(getDb(), {
        kind: "USER_ERASE",
        summary: `Erase ${userId}${body.reason ? ` — ${body.reason}` : ""}`,
        payload: { userIds: [userId], erase: true, reason: body.reason },
        reason: body.reason,
        requestedBy: auth.user.id,
      });
      await writeAuditLog(getDb(), {
        actorId: auth.user.id,
        actor: auth.user.username,
        action: "USER_ERASE_REQUESTED",
        target: userId,
        ip,
        userAgent,
        metadata: { approvalId: approval.id },
      });
      return jsonOk(
        {
          status: "pending_approval" as const,
          approvalId: approval.id,
          message: "Erase queued for second-admin approval.",
        },
        { status: 202 },
      );
    }

    const synapse = getSynapseClient();
    await synapse.deactivateUser(userId, false);

    await writeAuditLog(getDb(), {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "USER_DEACTIVATED",
      target: userId,
      ip,
      userAgent,
    });

    const { emitTrigger } = await import("@/lib/automation/emit");
    emitTrigger("USER_DEACTIVATED", {
      userId,
      erase: false,
      actor: auth.user.username,
    });

    return jsonOk({ status: "ok" as const });
  },
);
