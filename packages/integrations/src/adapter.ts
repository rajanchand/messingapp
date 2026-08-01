/** Common adapter contract for outbound integrations. */

export type IntegrationType = "slack" | "github" | "email" | "discord" | "jira" | "webhook";

export interface IntegrationContext {
  integrationId: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface AdapterResult {
  ok: boolean;
  status?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface IntegrationAdapter {
  readonly type: IntegrationType;
  /** Optional connectivity check. */
  test?(ctx: IntegrationContext): Promise<AdapterResult>;
  /** Execute a named operation (send_message, create_issue, …). */
  execute(
    ctx: IntegrationContext,
    operation: string,
    input: Record<string, unknown>,
  ): Promise<AdapterResult>;
}

export const INTEGRATION_TYPES: IntegrationType[] = [
  "slack",
  "github",
  "email",
  "discord",
  "jira",
  "webhook",
];
