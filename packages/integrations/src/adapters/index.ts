import type { IntegrationAdapter, IntegrationContext, AdapterResult } from "../adapter";

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<AdapterResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    message: text.slice(0, 500),
    data: { status: res.status },
  };
}

export const slackAdapter: IntegrationAdapter = {
  type: "slack",
  async test(ctx) {
    return postJson(
      "https://slack.com/api/auth.test",
      {},
      { Authorization: `Bearer ${ctx.secrets.botToken ?? ""}` },
    );
  },
  async execute(ctx, operation, input) {
    if (operation !== "send_message" && operation !== "SEND_SLACK") {
      return { ok: false, message: `Unsupported operation: ${operation}` };
    }
    const channel = String(input.channel ?? ctx.config.defaultChannel ?? "");
    const text = String(input.text ?? input.body ?? "");
    return postJson(
      "https://slack.com/api/chat.postMessage",
      { channel, text },
      { Authorization: `Bearer ${ctx.secrets.botToken ?? ""}` },
    );
  },
};

export const githubAdapter: IntegrationAdapter = {
  type: "github",
  async execute(ctx, operation, input) {
    const token = ctx.secrets.token ?? "";
    if (operation === "create_issue") {
      const owner = String(input.owner ?? ctx.config.owner ?? "");
      const repo = String(input.repo ?? ctx.config.repo ?? "");
      return postJson(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
        { title: input.title, body: input.body },
        {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      );
    }
    return { ok: false, message: `Unsupported operation: ${operation}` };
  },
};

export const emailAdapter: IntegrationAdapter = {
  type: "email",
  async execute(ctx, _operation, input) {
    const webhookUrl = ctx.secrets.smtpWebhookUrl ?? ctx.secrets.webhookUrl;
    if (!webhookUrl) {
      return {
        ok: false,
        message: "Email adapter requires smtpWebhookUrl secret (HTTPS relay).",
      };
    }
    return postJson(webhookUrl, {
      to: input.to ?? ctx.config.defaultTo,
      subject: input.subject,
      body: input.body ?? input.text,
      from: ctx.config.from,
    });
  },
};

export const discordAdapter: IntegrationAdapter = {
  type: "discord",
  async execute(ctx, _operation, input) {
    const url = ctx.secrets.webhookUrl ?? "";
    if (!url) return { ok: false, message: "Missing Discord webhookUrl" };
    return postJson(url, { content: String(input.text ?? input.body ?? "").slice(0, 2000) });
  },
};

export const jiraAdapter: IntegrationAdapter = {
  type: "jira",
  async execute(ctx, operation, input) {
    if (operation !== "create_issue") {
      return { ok: false, message: `Unsupported operation: ${operation}` };
    }
    const base = String(ctx.config.baseUrl ?? "").replace(/\/$/, "");
    const auth = Buffer.from(
      `${ctx.secrets.email ?? ""}:${ctx.secrets.apiToken ?? ""}`,
    ).toString("base64");
    return postJson(
      `${base}/rest/api/3/issue`,
      {
        fields: {
          project: { key: input.projectKey ?? ctx.config.projectKey },
          summary: input.summary ?? input.title,
          description: input.description ?? input.body,
          issuetype: { name: String(input.issueType ?? "Task") },
        },
      },
      { Authorization: `Basic ${auth}` },
    );
  },
};

export const webhookAdapter: IntegrationAdapter = {
  type: "webhook",
  async execute(ctx, _operation, input) {
    const url = String(input.url ?? ctx.config.url ?? ctx.secrets.url ?? "");
    if (!url) return { ok: false, message: "Missing webhook URL" };
    const headers = {
      ...((ctx.config.headers as Record<string, string> | undefined) ?? {}),
      ...((input.headers as Record<string, string> | undefined) ?? {}),
    };
    if (ctx.secrets.bearerToken) {
      headers.Authorization = `Bearer ${ctx.secrets.bearerToken}`;
    }
    return postJson(url, input.body ?? input, headers);
  },
};

export function getAdapter(type: string): IntegrationAdapter | undefined {
  const map: Record<string, IntegrationAdapter> = {
    slack: slackAdapter,
    github: githubAdapter,
    email: emailAdapter,
    discord: discordAdapter,
    jira: jiraAdapter,
    webhook: webhookAdapter,
  };
  return map[type];
}

export function buildContext(
  integrationId: string,
  config: Record<string, unknown> | null,
  secrets: Record<string, string>,
): IntegrationContext {
  return { integrationId, config: config ?? {}, secrets };
}
