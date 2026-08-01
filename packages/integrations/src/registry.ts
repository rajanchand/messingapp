import type { IntegrationAdapter } from "./types";
import { IntegrationError } from "./errors";
import { DiscordAdapter } from "./adapters/discord";
import { EmailAdapter } from "./adapters/email";
import { GitHubAdapter } from "./adapters/github";
import { JiraAdapter } from "./adapters/jira";
import { SlackAdapter } from "./adapters/slack";
import { WebhookAdapter } from "./adapters/webhook";

type AdapterFactory = () => IntegrationAdapter;

const ADAPTER_FACTORIES: Record<string, AdapterFactory> = {
  slack: () => new SlackAdapter(),
  github: () => new GitHubAdapter(),
  email: () => new EmailAdapter(),
  discord: () => new DiscordAdapter(),
  jira: () => new JiraAdapter(),
  webhook: () => new WebhookAdapter(),
};

/** Returns a new adapter instance for the given type. */
export function getAdapter(type: string): IntegrationAdapter {
  const factory = ADAPTER_FACTORIES[type];
  if (!factory) {
    throw new IntegrationError(`Unknown integration adapter type: ${type}`);
  }
  return factory();
}

/** Lists all registered adapter type identifiers. */
export function listAdapterTypes(): string[] {
  return Object.keys(ADAPTER_FACTORIES).sort();
}
