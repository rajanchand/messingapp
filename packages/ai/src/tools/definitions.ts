import type { ToolDefinition } from "../types";

/** OpenAI-format tool definitions for read-only admin queries. */
export const ADMIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description:
        "Request aggregated Matrix user statistics. Returns query parameters only; the admin app executes the lookup.",
      parameters: {
        type: "object",
        properties: {
          includeDeactivated: {
            type: "boolean",
            description: "Include deactivated accounts in the aggregate.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Optional cap when listing recent users.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_audit_summary",
      description:
        "Request an audit log summary for a time window or action filter. Execution happens in the admin app.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", format: "date-time", description: "Inclusive start (ISO 8601)." },
          to: { type: "string", format: "date-time", description: "Inclusive end (ISO 8601)." },
          action: { type: "string", description: "Filter by audit action code, e.g. USER_CREATED." },
          actor: { type: "string", description: "Filter by actor identifier." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_security_events",
      description:
        "Request security centre events (failed logins, lockouts, etc.). Returns filter args only.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Security event type filter." },
          from: { type: "string", format: "date-time" },
          to: { type: "string", format: "date-time" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_workflow_status",
      description:
        "Request workflow or run status from the automation engine. Does not trigger runs.",
      parameters: {
        type: "object",
        properties: {
          workflowId: { type: "string", format: "uuid", description: "Specific workflow id." },
          status: {
            type: "string",
            enum: ["pending", "running", "completed", "failed", "cancelled"],
          },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_integration_health",
      description:
        "Request integration adapter health (Slack, GitHub, email, etc.). Returns filter args only.",
      parameters: {
        type: "object",
        properties: {
          integrationId: { type: "string", format: "uuid" },
          type: {
            type: "string",
            enum: ["slack", "github", "email", "discord", "jira", "webhook"],
          },
          includeDisabled: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
];
