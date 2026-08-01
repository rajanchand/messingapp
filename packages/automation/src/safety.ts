/**
 * Safety guards for workflow execution: action caps, timeouts,
 * idempotency keys, and simple loop detection.
 */
import { createHash } from "node:crypto";

export const MAX_ACTIONS_PER_RUN = 20;
export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
export const MAX_TRIGGER_DEPTH = 3;

export interface SafetyLimits {
  maxActions: number;
  timeoutMs: number;
  maxTriggerDepth: number;
}

export const DEFAULT_SAFETY: SafetyLimits = {
  maxActions: MAX_ACTIONS_PER_RUN,
  timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
  maxTriggerDepth: MAX_TRIGGER_DEPTH,
};

export class SafetyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "max_actions"
      | "timeout"
      | "loop_detected"
      | "idempotency_conflict"
      | "invalid_definition",
  ) {
    super(message);
    this.name = "SafetyError";
  }
}

export function assertActionCount(count: number, limits: SafetyLimits = DEFAULT_SAFETY): void {
  if (count > limits.maxActions) {
    throw new SafetyError(
      `Workflow exceeds max actions (${count} > ${limits.maxActions})`,
      "max_actions",
    );
  }
}

/** Alias used by workflow definition validation. */
export const assertActionCountWithinLimit = assertActionCount;

export function assertTriggerDepth(depth: number, limits: SafetyLimits = DEFAULT_SAFETY): void {
  if (depth > limits.maxTriggerDepth) {
    throw new SafetyError(
      `Trigger cascade depth ${depth} exceeds limit ${limits.maxTriggerDepth}`,
      "loop_detected",
    );
  }
}

/** Detects if a workflow would immediately re-trigger itself via the same trigger type. */
export function detectSelfLoop(
  triggerType: string,
  actionTypes: string[],
  cascadeMap: Record<string, string[]>,
): boolean {
  const produced = new Set<string>();
  for (const action of actionTypes) {
    for (const t of cascadeMap[action] ?? []) produced.add(t);
  }
  return produced.has(triggerType);
}

/**
 * Known action → trigger cascades used for static loop detection.
 * Actions that can emit events which re-enter the engine.
 */
export const ACTION_TRIGGER_CASCADE: Record<string, string[]> = {
  DEACTIVATE_USER: ["USER_DEACTIVATED"],
  SEND_MATRIX_MESSAGE: [],
  SEND_SLACK: [],
  SEND_EMAIL: [],
  SEND_WEBHOOK: ["WEBHOOK_RECEIVED"],
  NOTIFY_ADMIN: [],
  WRITE_AUDIT: [],
  KICK_USER: [],
};

export function buildIdempotencyKey(
  workflowIdOrOpts: string | { workflowId: string; triggerType: string; payload?: unknown },
  triggerType?: string,
  fingerprint?: string,
): string {
  if (typeof workflowIdOrOpts === "object") {
    const fp = createHash("sha256")
      .update(JSON.stringify(workflowIdOrOpts.payload ?? null))
      .digest("hex")
      .slice(0, 24);
    return `${workflowIdOrOpts.workflowId}:${workflowIdOrOpts.triggerType}:${fp}`;
  }
  return `${workflowIdOrOpts}:${triggerType}:${fingerprint}`;
}

export interface WebhookLoopEntry {
  endpointUrl: string;
  runId: string;
  atMs: number;
}

/** Refuse to call the same webhook URL again within the same run cascade. */
export function assertNoWebhookLoop(history: WebhookLoopEntry[], url: string): void {
  if (history.some((h) => h.endpointUrl === url)) {
    throw new SafetyError(`Webhook loop detected for ${url}`, "loop_detected");
  }
}

export function assertRunWithinTimeLimit(
  startedAtMs: number,
  limits: SafetyLimits = DEFAULT_SAFETY,
): void {
  if (Date.now() - startedAtMs > limits.timeoutMs) {
    throw new SafetyError(`Workflow run exceeded ${limits.timeoutMs}ms`, "timeout");
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "workflow run",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SafetyError(`${label} timed out after ${timeoutMs}ms`, "timeout"));
    }, timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
