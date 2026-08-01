/**
 * BullMQ consumer for workflow runs.
 * Executes actions with safety timeouts; never crashes the process on a single job failure.
 */
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import {
  getDb,
  workflows,
  workflowRuns,
  workflowRunSteps,
  notifications,
  adminUsers,
  ipBlocks,
} from "@zts/database";
import { getRedis, writeAuditLog } from "@zts/security";
import {
  WORKFLOW_QUEUE_NAME,
  withTimeout,
  DEFAULT_RUN_TIMEOUT_MS,
  type TriggerJobData,
  type WorkflowDefinition,
  type WorkflowAction,
} from "@zts/automation";
import { getSynapseClient } from "@zts/matrix";
import { executeIntegrationAction } from "@zts/integrations";

async function runAction(
  action: WorkflowAction,
  payload: Record<string, unknown>,
  ctx: { runId: string; workflowId: string },
): Promise<Record<string, unknown>> {
  const config = action.config ?? {};
  switch (action.type) {
    case "NOTIFY_ADMIN": {
      const admins = await getDb().select({ id: adminUsers.id }).from(adminUsers);
      for (const a of admins) {
        await getDb().insert(notifications).values({
          userId: a.id,
          type: "workflow",
          title: String(config.title ?? "Workflow notification"),
          body: String(config.body ?? JSON.stringify(payload)).slice(0, 2000),
          href: config.href ? String(config.href) : null,
          metadata: { runId: ctx.runId, workflowId: ctx.workflowId },
        });
      }
      return { notified: admins.length };
    }
    case "WRITE_AUDIT": {
      await writeAuditLog(getDb(), {
        actor: "automation",
        action: String(config.action ?? "WORKFLOW_NOTE"),
        target: ctx.workflowId,
        metadata: { message: config.message, payload, runId: ctx.runId },
      });
      return { ok: true };
    }
    case "SEND_MATRIX_MESSAGE": {
      const roomId = String(config.roomId ?? "");
      const body = String(config.body ?? "");
      await getSynapseClient().sendRoomMessage(roomId, body);
      return { roomId };
    }
    case "SEND_SLACK":
    case "SEND_EMAIL":
    case "SEND_WEBHOOK": {
      return executeIntegrationAction(getDb(), action.type, config, payload);
    }
    case "DEACTIVATE_USER": {
      const userId = String(config.userId ?? payload.userId ?? "");
      await getSynapseClient().deactivateUser(userId, Boolean(config.erase));
      return { userId };
    }
    case "KICK_USER": {
      const roomId = String(config.roomId ?? "");
      const userId = String(config.userId ?? "");
      await getSynapseClient().kickUser(roomId, userId, String(config.reason ?? ""));
      return { roomId, userId };
    }
    case "BAN_USER": {
      const roomId = String(config.roomId ?? "");
      const userId = String(config.userId ?? "");
      await getSynapseClient().banUser(roomId, userId, String(config.reason ?? ""));
      return { roomId, userId };
    }
    case "UNBAN_USER": {
      const roomId = String(config.roomId ?? "");
      const userId = String(config.userId ?? "");
      await getSynapseClient().unbanUser(roomId, userId);
      return { roomId, userId };
    }
    case "SHADOW_BAN_USER": {
      const userId = String(config.userId ?? payload.userId ?? "");
      const shadowBanned = config.shadowBanned !== false && config.shadowBanned !== "false";
      await getSynapseClient().setShadowBan(userId, Boolean(shadowBanned));
      return { userId, shadowBanned: Boolean(shadowBanned) };
    }
    case "BLOCK_IP": {
      const cidr = String(config.cidr ?? payload.ip ?? "");
      if (!cidr) throw new Error("BLOCK_IP requires cidr or payload.ip");
      const ttlMinutes = Number(config.ttlMinutes ?? 60);
      const expiresAt =
        ttlMinutes > 0 ? new Date(Date.now() + ttlMinutes * 60_000) : null;
      const [row] = await getDb()
        .insert(ipBlocks)
        .values({
          cidr,
          reason: String(config.reason ?? "Automation BLOCK_IP"),
          expiresAt,
        })
        .returning()
        .onConflictDoNothing();
      await writeAuditLog(getDb(), {
        actor: "automation",
        action: "IP_BLOCKED",
        target: cidr,
        metadata: { runId: ctx.runId, created: Boolean(row) },
      });
      return { cidr, created: Boolean(row) };
    }
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

async function processJob(data: TriggerJobData): Promise<void> {
  const db = getDb();
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, data.workflowId));
  if (!wf) {
    await db
      .update(workflowRuns)
      .set({ status: "failed", error: "Workflow missing", finishedAt: new Date() })
      .where(eq(workflowRuns.id, data.runId));
    return;
  }

  const definition = wf.definition as WorkflowDefinition;
  await db
    .update(workflowRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(workflowRuns.id, data.runId));

  try {
    await withTimeout(
      (async () => {
        let index = 0;
        for (const action of definition.actions) {
          const [step] = await db
            .insert(workflowRunSteps)
            .values({
              runId: data.runId,
              stepIndex: index,
              actionType: action.type,
              status: "running",
              input: action.config ?? {},
              startedAt: new Date(),
            })
            .returning();

          try {
            const output = await runAction(action, data.payload, {
              runId: data.runId,
              workflowId: data.workflowId,
            });
            if (step) {
              await db
                .update(workflowRunSteps)
                .set({ status: "succeeded", output, finishedAt: new Date() })
                .where(eq(workflowRunSteps.id, step.id));
            }
          } catch (err) {
            if (step) {
              await db
                .update(workflowRunSteps)
                .set({
                  status: "failed",
                  error: err instanceof Error ? err.message : String(err),
                  finishedAt: new Date(),
                })
                .where(eq(workflowRunSteps.id, step.id));
            }
            throw err;
          }
          index += 1;
        }
      })(),
      DEFAULT_RUN_TIMEOUT_MS,
    );

    await db
      .update(workflowRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(workflowRuns.id, data.runId));
    await db
      .update(workflows)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(workflows.id, data.workflowId));
  } catch (err) {
    await db
      .update(workflowRuns)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      })
      .where(eq(workflowRuns.id, data.runId));
    throw err;
  }
}

export function startAutomationWorker(): Worker<TriggerJobData> {
  const connection = getRedis();
  const worker = new Worker<TriggerJobData>(
    WORKFLOW_QUEUE_NAME,
    async (job) => {
      await processJob(job.data);
    },
    { connection, concurrency: Number(process.env.AUTOMATION_CONCURRENCY ?? 5) },
  );

  worker.on("failed", (job, err) => {
    console.error(`[automation-worker] job ${job?.id} failed:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[automation-worker] job ${job.id} completed`);
  });

  return worker;
}
