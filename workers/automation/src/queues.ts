export const QUEUE_NAMES = {
  automation: "automation",
  notifications: "notifications",
  webhooks: "webhooks",
  email: "email",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface AutomationJobData {
  workflowId: string;
  triggerType: string;
  triggerPayload?: unknown;
  idempotencyKey?: string;
  sudoConfirmed?: boolean;
}

export interface NotificationJobData {
  userId?: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookJobData {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  runId?: string;
  workflowId?: string;
}

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}
