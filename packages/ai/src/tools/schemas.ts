import { z } from "zod";

/** Read-only admin query tool names. Execution happens in the admin app. */
export const ADMIN_TOOL_NAMES = [
  "get_user_stats",
  "get_audit_summary",
  "get_security_events",
  "get_workflow_status",
  "get_integration_health",
] as const;

export type AdminToolName = (typeof ADMIN_TOOL_NAMES)[number];

export const getUserStatsArgsSchema = z.object({
  includeDeactivated: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const getAuditSummaryArgsSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  action: z.string().min(1).max(128).optional(),
  actor: z.string().min(1).max(256).optional(),
});

export const getSecurityEventsArgsSchema = z.object({
  type: z.string().min(1).max(128).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const getWorkflowStatusArgsSchema = z.object({
  workflowId: z.uuid().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const getIntegrationHealthArgsSchema = z.object({
  integrationId: z.uuid().optional(),
  type: z.enum(["slack", "github", "email", "discord", "jira", "webhook"]).optional(),
  includeDisabled: z.boolean().optional(),
});

export type GetUserStatsArgs = z.infer<typeof getUserStatsArgsSchema>;
export type GetAuditSummaryArgs = z.infer<typeof getAuditSummaryArgsSchema>;
export type GetSecurityEventsArgs = z.infer<typeof getSecurityEventsArgsSchema>;
export type GetWorkflowStatusArgs = z.infer<typeof getWorkflowStatusArgsSchema>;
export type GetIntegrationHealthArgs = z.infer<typeof getIntegrationHealthArgsSchema>;

export type AdminToolArgs =
  | GetUserStatsArgs
  | GetAuditSummaryArgs
  | GetSecurityEventsArgs
  | GetWorkflowStatusArgs
  | GetIntegrationHealthArgs;

const adminToolSchemas: Record<AdminToolName, z.ZodType<AdminToolArgs>> = {
  get_user_stats: getUserStatsArgsSchema,
  get_audit_summary: getAuditSummaryArgsSchema,
  get_security_events: getSecurityEventsArgsSchema,
  get_workflow_status: getWorkflowStatusArgsSchema,
  get_integration_health: getIntegrationHealthArgsSchema,
};

export function isAdminToolName(name: string): name is AdminToolName {
  return (ADMIN_TOOL_NAMES as readonly string[]).includes(name);
}

/** Validates structured args for a read-only admin tool. Does not execute the query. */
export function parseAdminToolArgs(name: AdminToolName, raw: unknown): AdminToolArgs {
  const schema = adminToolSchemas[name];
  return schema.parse(raw);
}

/** Parses JSON tool-call arguments and validates against the tool schema. */
export function parseAdminToolCall(name: AdminToolName, argumentsJson: string): AdminToolArgs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson) as unknown;
  } catch {
    throw new Error(`Invalid JSON for tool "${name}".`);
  }
  return parseAdminToolArgs(name, parsed);
}

export function getAdminToolSchema(name: AdminToolName): z.ZodType<AdminToolArgs> {
  return adminToolSchemas[name];
}
