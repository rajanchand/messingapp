import type { HttpAdapterOptions } from "../types";
import { httpRequest, optionalString, parseUrl, requireString } from "./http";

/** Jira Cloud integration via base URL, email, and API token. */
export class JiraAdapter {
  readonly type = "jira";

  private baseUrl: string | undefined;
  private authHeader: string | undefined;
  private defaultProjectKey: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    const baseUrl = requireString(config.baseUrl, "baseUrl").replace(/\/+$/, "");
    parseUrl(baseUrl, "baseUrl");

    const email = requireString(secrets.email, "email");
    const apiToken = requireString(secrets.apiToken, "apiToken");

    this.baseUrl = baseUrl;
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
    this.defaultProjectKey = optionalString(config.projectKey);
  }

  async disconnect(): Promise<void> {
    this.baseUrl = undefined;
    this.authHeader = undefined;
    this.defaultProjectKey = undefined;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();

    const response = await this.apiRequest("GET", "/rest/api/3/myself");
    if (response.ok) {
      const user = (await response.json()) as { displayName?: string };
      return { ok: true, message: `Jira authenticated as ${user.displayName ?? "user"}` };
    }
    return { ok: false, message: `Jira API returned ${response.status}` };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const projectKey =
      optionalString(payload.projectKey) ?? this.defaultProjectKey ?? requireString(payload.projectKey, "projectKey");
    const summary = requireString(payload.summary ?? payload.title, "summary");
    const description = optionalString(payload.description ?? payload.body) ?? "";
    const issueType = optionalString(payload.issueType) ?? "Task";

    const response = await this.apiRequest("POST", "/rest/api/3/issue", {
      fields: {
        project: { key: projectKey },
        summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        },
        issuetype: { name: issueType },
      },
    });

    if (response.ok) return { ok: true };
    return { ok: false, message: `Jira issue creation returned ${response.status}` };
  }

  private ensureConnected(): void {
    if (!this.baseUrl || !this.authHeader) {
      throw new Error("Jira adapter is not connected");
    }
  }

  private apiRequest(method: string, path: string, body?: unknown): Promise<Response> {
    return httpRequest(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          Authorization: this.authHeader!,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
  }
}
