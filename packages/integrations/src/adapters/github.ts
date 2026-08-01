import type { HttpAdapterOptions } from "../types";
import { httpRequest, optionalString, requireString } from "./http";

/**
 * GitHub integration using a personal access token.
 * Supports outbound repository dispatch and issue creation.
 */
export class GitHubAdapter {
  readonly type = "github";

  private token: string | undefined;
  private owner: string | undefined;
  private repo: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async connect(config: Record<string, unknown>, secrets: Record<string, string>): Promise<void> {
    this.token = requireString(secrets.pat ?? secrets.token, "pat");
    this.owner = optionalString(config.owner);
    this.repo = optionalString(config.repo);
  }

  async disconnect(): Promise<void> {
    this.token = undefined;
    this.owner = undefined;
    this.repo = undefined;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    this.ensureConnected();

    const response = await this.apiRequest("GET", "/user");
    if (response.ok) {
      const user = (await response.json()) as { login?: string };
      return { ok: true, message: `GitHub authenticated as ${user.login ?? "user"}` };
    }
    return { ok: false, message: `GitHub API returned ${response.status}` };
  }

  async send(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    this.ensureConnected();

    const owner = optionalString(payload.owner) ?? this.owner;
    const repo = optionalString(payload.repo) ?? this.repo;
    if (!owner || !repo) {
      return { ok: false, message: "owner and repo are required in config or payload" };
    }

    const action = optionalString(payload.action) ?? "issue";

    if (action === "dispatch") {
      const eventType = requireString(payload.eventType, "eventType");
      const clientPayload =
        payload.clientPayload && typeof payload.clientPayload === "object"
          ? payload.clientPayload
          : {};

      const response = await this.apiRequest(
        "POST",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`,
        { event_type: eventType, client_payload: clientPayload },
      );
      if (response.ok || response.status === 204) return { ok: true };
      return { ok: false, message: `GitHub dispatch returned ${response.status}` };
    }

    const title = requireString(payload.title, "title");
    const body = optionalString(payload.body) ?? "";

    const response = await this.apiRequest(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      { title, body },
    );
    if (response.ok) return { ok: true };
    return { ok: false, message: `GitHub issue creation returned ${response.status}` };
  }

  async handleInbound(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ handled: boolean; event?: string; data?: unknown }> {
    const event = headers["x-github-event"] ?? headers["X-GitHub-Event"];
    if (!event) {
      return { handled: false };
    }
    return { handled: true, event, data: body };
  }

  private ensureConnected(): void {
    if (!this.token) {
      throw new Error("GitHub adapter is not connected");
    }
  }

  private apiRequest(method: string, path: string, body?: unknown): Promise<Response> {
    return httpRequest(
      `https://api.github.com${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { fetchFn: this.fetchFn, timeoutMs: this.timeoutMs },
    );
  }
}
