import { z } from "zod";
import { ACTION_TYPES, TRIGGER_TYPES } from "./catalog";

export const conditionOperatorSchema = z.enum([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "exists",
  "not_exists",
]);

export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const conditionSchema = z.object({
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.unknown().optional(),
});

export type Condition = z.infer<typeof conditionSchema>;

const actionConfigSchema = z.record(z.string(), z.unknown());

export const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  config: actionConfigSchema.default({}),
  /** Optional human-readable label for builder UI and run logs. */
  label: z.string().optional(),
});

export type Action = z.infer<typeof actionSchema>;

export const scheduleSchema = z.object({
  cron: z.string().min(1),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export const workflowDefinitionSchema = z.object({
  conditions: z.array(conditionSchema).optional(),
  actions: z.array(actionSchema).min(1),
  schedule: scheduleSchema.optional(),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const triggerTypeSchema = z.enum(TRIGGER_TYPES);
