import { z } from "zod";
import { getDefaultLlmProvider } from "./provider";
import type { LlmProvider } from "./types";

/** Aligns with `@zts/automation` trigger catalog. */
export const WORKFLOW_TRIGGER_TYPES = [
  "USER_CREATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "ROOM_CREATED",
  "SECURITY_EVENT",
  "WEBHOOK_RECEIVED",
  "MANUAL",
  "SCHEDULE",
] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const workflowConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.unknown().optional(),
});

export const workflowActionSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

/** JSON stored in `workflows.definition` (compatible with automation package). */
export const workflowDefinitionSchema = z.object({
  conditions: z.array(workflowConditionSchema).default([]),
  actions: z.array(workflowActionSchema).min(1),
  schedule: z.object({ cron: z.string().min(1) }).optional(),
});

export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Draft returned by natural-language workflow authoring — not persisted. */
export interface WorkflowDraft {
  name: string;
  description: string;
  triggerType: WorkflowTriggerType;
  enabled: false;
  definition: WorkflowDefinition;
}

export interface DraftWorkflowOptions {
  provider?: LlmProvider;
}

const workflowDraftResponseSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  triggerType: z.enum(WORKFLOW_TRIGGER_TYPES),
  enabled: z.literal(false),
  definition: workflowDefinitionSchema,
});

function inferTriggerType(prompt: string): WorkflowTriggerType {
  const lower = prompt.toLowerCase();
  if (/\b(deactiv|disable|suspend)\b/.test(lower)) return "USER_DEACTIVATED";
  if (/\b(reactiv)\b/.test(lower)) return "USER_REACTIVATED";
  if (/\b(security|alert|login|failed)\b/.test(lower)) return "SECURITY_EVENT";
  if (/\b(webhook|inbound|http)\b/.test(lower)) return "WEBHOOK_RECEIVED";
  if (/\b(schedule|cron|daily|weekly|hourly)\b/.test(lower)) return "SCHEDULE";
  if (/\b(room)\b/.test(lower)) return "ROOM_CREATED";
  return "USER_CREATED";
}

function inferActions(prompt: string): WorkflowAction[] {
  const lower = prompt.toLowerCase();
  const actions: WorkflowAction[] = [];

  if (/\b(notify|alert|email|slack|message)\b/.test(lower)) {
    actions.push({ type: "NOTIFY_ADMIN", config: { title: "Workflow fired", body: prompt.slice(0, 200) } });
  }
  if (/\b(audit|log)\b/.test(lower)) {
    actions.push({ type: "WRITE_AUDIT", config: { action: "WORKFLOW_TRIGGERED", message: prompt.slice(0, 200) } });
  }
  if (/\bslack\b/.test(lower)) {
    actions.push({ type: "SEND_SLACK", config: { text: prompt.slice(0, 200) } });
  }

  if (actions.length === 0) {
    actions.push({ type: "WRITE_AUDIT", config: { action: "WORKFLOW_TRIGGERED" } });
  }

  return actions;
}

function inferSchedule(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  if (/\b(hourly|every hour)\b/.test(lower)) return "0 * * * *";
  if (/\b(daily|every day)\b/.test(lower)) return "0 9 * * *";
  if (/\b(weekly|every week)\b/.test(lower)) return "0 9 * * 1";
  return undefined;
}

function buildHeuristicDraft(prompt: string): WorkflowDraft {
  const triggerType = inferTriggerType(prompt);
  const cron =
    triggerType === "SCHEDULE" ? (inferSchedule(prompt) ?? "0 9 * * *") : undefined;
  const trimmed = prompt.trim();
  const name =
    trimmed.length > 64 ? `${trimmed.slice(0, 61).trim()}...` : trimmed || "New automation workflow";

  return {
    name,
    description: `Draft workflow generated from: ${trimmed || "empty prompt"}`,
    triggerType,
    enabled: false,
    definition: {
      conditions: [],
      actions: inferActions(prompt),
      ...(cron ? { schedule: { cron } } : {}),
    },
  };
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response did not contain a JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

/**
 * Converts natural language into a WorkflowDefinition-shaped draft.
 * Uses the configured LLM when `AI_API_KEY` is present; otherwise applies a
 * deterministic template. Never fabricates live counts or runtime metrics.
 */
export async function draftWorkflowFromNaturalLanguage(
  prompt: string,
  options: DraftWorkflowOptions = {},
): Promise<WorkflowDraft> {
  const provider = options.provider ?? getDefaultLlmProvider();

  if (provider.isConfigured() === false) {
    return buildHeuristicDraft(prompt);
  }

  const systemPrompt = [
    "You draft automation workflow JSON for a Zero Trust admin platform.",
    "Return ONLY valid JSON matching this shape:",
    '{ "name": string, "description": string, "triggerType": USER_CREATED|USER_DEACTIVATED|USER_REACTIVATED|ROOM_CREATED|SECURITY_EVENT|WEBHOOK_RECEIVED|MANUAL|SCHEDULE, "enabled": false, "definition": { "conditions": [], "actions": [{ "type": string, "config": {} }], "schedule"?: { "cron": string } } }',
    "Allowed action types: NOTIFY_ADMIN, WRITE_AUDIT, SEND_MATRIX_MESSAGE, SEND_SLACK, SEND_EMAIL, SEND_WEBHOOK, DEACTIVATE_USER, KICK_USER.",
    "Rules: enabled must be false; do not include user counts, statistics, or invented runtime data; use empty conditions unless the prompt specifies filters.",
  ].join("\n");

  try {
    const response = await provider.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    if (!response.content) {
      return buildHeuristicDraft(prompt);
    }

    const parsed = extractJsonObject(response.content);
    const draft = workflowDraftResponseSchema.parse(parsed);
    return draft;
  } catch {
    return buildHeuristicDraft(prompt);
  }
}

export function validateWorkflowDefinition(definition: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(definition);
}
