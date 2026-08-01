export interface IntegrationAdapter {
  readonly type: string;
  connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void>;
  disconnect(): Promise<void>;
  test(): Promise<{ ok: boolean; message: string }>;
  send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  handleInbound?(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ handled: boolean; event?: string; data?: unknown }>;
}

export type IntegrationType = "slack" | "github" | "email" | "discord" | "jira" | "webhook";

export interface HttpAdapterOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}
