import type { ZodIssue } from "zod";
import { DESTRUCTIVE_ACTION_TYPES, ACTION_TYPES } from "./catalog";
import { assertActionCountWithinLimit } from "./safety";
import {
  actionSchema,
  type Action,
  type WorkflowDefinition,
  workflowDefinitionSchema,
} from "./schema";

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ZodIssue[] = [],
  ) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

function validateScheduleCron(cron: string): void {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    throw new WorkflowValidationError(
      `Schedule cron must have 5 or 6 fields (got ${parts.length})`,
    );
  }
}

export function isDestructiveAction(type: string): boolean {
  return (DESTRUCTIVE_ACTION_TYPES as readonly string[]).includes(type);
}

export function isPrivilegedAction(type: string): boolean {
  return ACTIONS_PRIVILEGED.has(type);
}

const ACTIONS_PRIVILEGED = new Set<string>([
  "SEND_MATRIX_MESSAGE",
  "SEND_SLACK",
  "SEND_EMAIL",
  "SEND_WEBHOOK",
  "DEACTIVATE_USER",
  "KICK_USER",
  ...DESTRUCTIVE_ACTION_TYPES,
]);

export function validateWorkflowDefinition(def: unknown): WorkflowDefinition {
  const parsed = workflowDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    throw new WorkflowValidationError(
      "Workflow definition failed schema validation",
      parsed.error.issues,
    );
  }

  const workflow = parsed.data;

  try {
    assertActionCountWithinLimit(workflow.actions.length);
  } catch (err) {
    if (err instanceof Error) {
      throw new WorkflowValidationError(err.message);
    }
    throw err;
  }

  if (workflow.schedule) {
    validateScheduleCron(workflow.schedule.cron);
  }

  const known = new Set<string>(ACTION_TYPES);
  workflow.actions.forEach((action: Action, index: number) => {
    const actionParsed = actionSchema.safeParse(action);
    if (!actionParsed.success) {
      throw new WorkflowValidationError(
        `Action at index ${index} is invalid`,
        actionParsed.error.issues,
      );
    }
    if (!known.has(action.type)) {
      throw new WorkflowValidationError(`Unknown action type: ${action.type}`);
    }
  });

  return workflow;
}
