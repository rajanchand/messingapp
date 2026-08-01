import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, aiProposals, workflows, ipBlocks } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createProposal, isAiProposalKind } from "@zts/ai";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";
import { getSynapseClient } from "@zts/matrix";
import { emitTrigger } from "@/lib/automation/emit";

export const GET = createApiHandler(
  { permission: "settings.read", rateLimit: "api" },
  async ({ auth }) => {
    const proposals = await getDb()
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.userId, auth.user.id))
      .orderBy(desc(aiProposals.createdAt))
      .limit(20);
    return jsonOk({ proposals });
  },
);

const bodySchema = z.object({
  proposalId: z.string().uuid().optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  /** Create a new pending proposal (without executing). */
  create: z
    .object({
      kind: z.string(),
      summary: z.string().min(1).max(2000),
      payload: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export const POST = createApiHandler(
  {
    permission: "settings.manage",
    bodySchema,
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();

    if (body.create) {
      if (!isAiProposalKind(body.create.kind)) {
        return jsonError(400, "validation", "Unknown proposal kind.");
      }
      const insert = createProposal(body.create.kind, body.create.summary, body.create.payload);
      const [row] = await db
        .insert(aiProposals)
        .values({
          userId: auth.user.id,
          kind: insert.kind,
          summary: insert.summary,
          payload: insert.payload,
          status: "pending",
        })
        .returning();
      return jsonOk({ proposal: row }, { status: 201 });
    }

    if (!body.proposalId || !body.decision) {
      return jsonError(400, "validation", "proposalId and decision required.");
    }

    // Approvals require sudo.
    if (body.decision === "approve") {
      const { isSudoActive } = await import("@zts/auth");
      if (!isSudoActive(auth.session)) {
        return jsonError(403, "sudo_required", "Re-authentication required.");
      }
    }

    const [proposal] = await db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.id, body.proposalId), eq(aiProposals.userId, auth.user.id)));

    if (!proposal) return jsonError(404, "not_found", "Proposal not found.");
    if (proposal.status !== "pending") {
      return jsonError(409, "conflict", "Proposal already decided.");
    }

    if (body.decision === "reject") {
      await db
        .update(aiProposals)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(eq(aiProposals.id, proposal.id));
      return jsonOk({ status: "rejected" });
    }

    const payload = proposal.payload as Record<string, unknown>;
    let result: unknown;

    switch (proposal.kind) {
      case "user.deactivate": {
        const userId = String(payload.matrixUserId ?? payload.userId ?? "");
        await getSynapseClient().deactivateUser(userId, Boolean(payload.erase));
        emitTrigger("USER_DEACTIVATED", {
          userId,
          erase: Boolean(payload.erase),
          actor: auth.user.username,
        });
        result = { userId };
        break;
      }
      case "workflow.create": {
        const [wf] = await db
          .insert(workflows)
          .values({
            name: String(payload.name ?? "AI draft"),
            description: String(payload.description ?? ""),
            triggerType: String(payload.triggerType ?? "MANUAL"),
            enabled: false,
            definition: payload.definition ?? { actions: [{ type: "NOTIFY_ADMIN", config: {} }] },
            ownerId: auth.user.id,
          })
          .returning();
        result = { workflow: wf };
        break;
      }
      case "workflow.enable":
      case "workflow.disable": {
        const id = String(payload.workflowId ?? "");
        await db
          .update(workflows)
          .set({
            enabled: proposal.kind === "workflow.enable",
            updatedAt: new Date(),
          })
          .where(eq(workflows.id, id));
        result = { workflowId: id };
        break;
      }
      case "security.block_ip": {
        const cidr = String(payload.cidr ?? "");
        const [block] = await db
          .insert(ipBlocks)
          .values({
            cidr,
            reason: String(payload.reason ?? "AI proposal"),
            createdBy: auth.user.id,
          })
          .returning();
        result = { block };
        break;
      }
      default:
        return jsonError(400, "validation", `Unhandled proposal kind: ${proposal.kind}`);
    }

    await db
      .update(aiProposals)
      .set({ status: "approved", decidedAt: new Date() })
      .where(eq(aiProposals.id, proposal.id));

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "AI_PROPOSAL_APPROVED",
      target: proposal.id,
      ip,
      userAgent,
      metadata: { kind: proposal.kind },
    });

    return jsonOk({ status: "approved", result });
  },
);
