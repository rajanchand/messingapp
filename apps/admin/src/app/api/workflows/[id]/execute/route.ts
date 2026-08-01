import { eq } from "drizzle-orm";
import { getDb, workflows, workflowRuns } from "@zts/database";
import {
  isDestructiveAction,
  getWorkflowQueue,
  type WorkflowDefinition,
} from "@zts/automation";
import { getRedis, writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

export const POST = createApiHandler(
  { permission: "automation.execute", rateLimit: "mutation" },
  async ({ auth, params, ip, userAgent }) => {
    const db = getDb();
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, params.id!));
    if (!wf) return jsonError(404, "not_found", "Workflow not found.");

    const definition = wf.definition as WorkflowDefinition;
    const destructive = (definition.actions ?? []).some((a) => isDestructiveAction(a.type));
    if (destructive) {
      const { isSudoActive } = await import("@zts/auth");
      if (!isSudoActive(auth.session)) {
        return jsonError(403, "sudo_required", "Re-authentication required for destructive workflows.");
      }
    }

    const payload = { actor: auth.user.username, manual: true };
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        version: wf.version,
        status: "pending",
        triggerType: "MANUAL",
        triggerPayload: payload,
      })
      .returning();

    if (!run) return jsonError(500, "internal", "Failed to create run.");

    await getWorkflowQueue(getRedis()).add("run", {
      workflowId: wf.id,
      runId: run.id,
      triggerType: "MANUAL",
      payload,
      depth: 0,
    });

    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "WORKFLOW_EXECUTED",
      target: wf.id,
      ip,
      userAgent,
      metadata: { runId: run.id },
    });

    return jsonOk({ run });
  },
);
