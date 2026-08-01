/** Trigger and action catalogs for the automation engine. */

export interface TriggerDefinition {
  type: string;
  label: string;
  description: string;
  /** JSON Schema-ish shape of the payload fields available to conditions. */
  payloadFields: string[];
}

export interface ActionDefinition {
  type: string;
  label: string;
  description: string;
  /** Whether this action can mutate state (needs careful RBAC). */
  privileged: boolean;
  configFields: string[];
}

export const TRIGGERS: TriggerDefinition[] = [
  {
    type: "USER_CREATED",
    label: "User created",
    description: "Fires when a Matrix user is created via the admin panel.",
    payloadFields: ["userId", "admin", "actor"],
  },
  {
    type: "USER_DEACTIVATED",
    label: "User deactivated",
    description: "Fires when a Matrix user is deactivated or erased.",
    payloadFields: ["userId", "erase", "actor"],
  },
  {
    type: "USER_REACTIVATED",
    label: "User reactivated",
    description: "Fires when a deactivated user is reactivated.",
    payloadFields: ["userId", "actor"],
  },
  {
    type: "ROOM_CREATED",
    label: "Room created",
    description: "Fires when a room is created.",
    payloadFields: ["roomId", "name", "actor"],
  },
  {
    type: "SECURITY_EVENT",
    label: "Security event",
    description: "Fires on high-severity security events.",
    payloadFields: ["type", "severity", "ip", "userId"],
  },
  {
    type: "WEBHOOK_RECEIVED",
    label: "Inbound webhook",
    description: "Fires when an inbound webhook endpoint receives a valid delivery.",
    payloadFields: ["endpointId", "slug", "payload"],
  },
  {
    type: "MANUAL",
    label: "Manual run",
    description: "Triggered explicitly by an admin.",
    payloadFields: ["actor"],
  },
  {
    type: "SCHEDULE",
    label: "Schedule",
    description: "Cron / interval schedule (worker cron).",
    payloadFields: ["scheduledAt"],
  },
];

export const ACTIONS: ActionDefinition[] = [
  {
    type: "NOTIFY_ADMIN",
    label: "Notify admin",
    description: "Create an in-app notification for panel admins.",
    privileged: false,
    configFields: ["title", "body", "href"],
  },
  {
    type: "WRITE_AUDIT",
    label: "Write audit note",
    description: "Append a custom audit log entry.",
    privileged: false,
    configFields: ["action", "message"],
  },
  {
    type: "SEND_MATRIX_MESSAGE",
    label: "Send Matrix message",
    description: "Post a message to a room via the bot token.",
    privileged: true,
    configFields: ["roomId", "body"],
  },
  {
    type: "SEND_SLACK",
    label: "Send Slack message",
    description: "Post via a configured Slack integration.",
    privileged: true,
    configFields: ["integrationId", "channel", "text"],
  },
  {
    type: "SEND_EMAIL",
    label: "Send email",
    description: "Send mail via a configured email integration.",
    privileged: true,
    configFields: ["integrationId", "to", "subject", "body"],
  },
  {
    type: "SEND_WEBHOOK",
    label: "Outbound webhook",
    description: "POST JSON to an external URL.",
    privileged: true,
    configFields: ["url", "headers", "body"],
  },
  {
    type: "DEACTIVATE_USER",
    label: "Deactivate user",
    description: "Deactivate a Matrix user (privileged).",
    privileged: true,
    configFields: ["userId", "erase"],
  },
  {
    type: "KICK_USER",
    label: "Kick from room",
    description: "Kick a user from a room.",
    privileged: true,
    configFields: ["roomId", "userId", "reason"],
  },
];

export function getTrigger(type: string): TriggerDefinition | undefined {
  return TRIGGERS.find((t) => t.type === type);
}

export function getAction(type: string): ActionDefinition | undefined {
  return ACTIONS.find((a) => a.type === type);
}

export const TRIGGER_TYPES = TRIGGERS.map((t) => t.type) as [
  string,
  ...string[],
];

export const ACTION_TYPES = ACTIONS.map((a) => a.type) as [string, ...string[]];

export type ActionType = (typeof ACTION_TYPES)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const DESTRUCTIVE_ACTION_TYPES = [
  "DEACTIVATE_USER",
  "KICK_USER",
] as const satisfies readonly ActionType[];
