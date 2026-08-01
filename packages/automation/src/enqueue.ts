import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Database } from "@zts/database";
import { and, eq } from "drizzle-orm";
import { workflows, workflowRuns } from "@zts/database";
import { evaluateConditions, type ConditionGroup } from "./conditions";
import {
  ACTION_TRIGGER_CASCADE,
  assertActionCount,
  assertTriggerDepth,
  buildIdempotencyKey,
  detectSelfLoop,
  SafetyError,
} from "./safety";

export const WORKFLOW_QUEUE_NAME = "zts-workflows";

export interface WorkflowAction {
  type: string;
  config?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  conditions?: ConditionGroup;
  actions: WorkflowAction[];
}

export interface TriggerJobData {
  workflowId: string;
  runId: string;
  triggerType: string;
  payload: Record<string, unknown>;
  depth: number;
}

let queue: Queue<TriggerJobData> | null = null;

export function getWorkflowQueue(connection: Redis): Queue<TriggerJobData> {
  if (!queue) {
    queue = new Queue<TriggerJobData>(WORKFLOW_QUEUE_NAME, { connection });
  }
  return queue;
}

function fingerprintPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

/**
 * Fan-out: find enabled workflows for a trigger, evaluate conditions,
 * create run rows, and enqueue BullMQ jobs. Never throws to callers —
 * failures are logged via the returned summary.
 */
export async function dispatchTrigger(
  db: Database,
  connection: Redis,
  triggerType: string,
  payload: Record<string, unknown>,
  options: { depth?: number; actorId?: string | null } = {},
): Promise<{ enqueued: number; skipped: number; errors: string[] }> {
  const depth = options.depth ?? 0;
  const errors: string[] = [];
  let enqueued = 0;
  let skipped = 0;

  try {
    assertTriggerDepth(depth);
  } catch (err) {
    return {
      enqueued: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  const candidates = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.enabled, true), eq(workflows.triggerType, triggerType)));

  const q = getWorkflowQueue(connection);

  for (const wf of candidates) {
    try {
      const definition = wf.definition as WorkflowDefinition;
      if (!Array.isArray(definition?.actions)) {
        throw new SafetyError("Invalid workflow definition", "invalid_definition");
      }
      assertActionCount(definition.actions.length);
      if (
        detectSelfLoop(
          triggerType,
          definition.actions.map((a) => a.type),
          ACTION_TRIGGER_CASCADE,
        ) &&
        depth > 0
      ) {
        skipped += 1;
        continue;
      }

      if (!evaluateConditions(definition.conditions, payload)) {
        skipped += 1;
        continue;
      }

      const idempotencyKey = buildIdempotencyKey(
        wf.id,
        triggerType,
        fingerprintPayload(payload),
      );

      const existing = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(eq(workflowRuns.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing[0]) {
        skipped += 1;
        continue;
      }

      const [run] = await db
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          version: wf.version,
          status: "pending",
          triggerType,
          triggerPayload: payload,
          idempotencyKey,
        })
        .returning();

      if (!run) {
        skipped += 1;
        continue;
      }

      await q.add(
        "run",
        {
          workflowId: wf.id,
          runId: run.id,
          triggerType,
          payload,
          depth,
        },
        {
          jobId: idempotencyKey,
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      );
      enqueued += 1;
    } catch (err) {
      errors.push(`${wf.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { enqueued, skipped, errors };
}

/** Fire-and-forget wrapper that never rejects. */
export function dispatchTriggerSafe(
  db: Database,
  connection: Redis,
  triggerType: string,
  payload: Record<string, unknown>,
  options?: { depth?: number; actorId?: string | null },
): void {
  void dispatchTrigger(db, connection, triggerType, payload, options).catch(() => {
    // Intentionally swallowed — triggers must not break primary request paths.
  });
}
