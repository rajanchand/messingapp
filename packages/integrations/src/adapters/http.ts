import type { HttpAdapterOptions } from "../types";

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Minimal fetch wrapper with timeout. Credentials are never logged.
 */
export async function httpRequest(
  url: string,
  opts: HttpRequestOptions,
  adapterOpts: HttpAdapterOptions = {},
): Promise<Response> {
  const fetchFn = adapterOpts.fetchFn ?? fetch;
  const timeoutMs = adapterOpts.timeoutMs ?? 15_000;
  return fetchFn(url, {
    method: opts.method ?? "GET",
    headers: opts.headers,
    body: opts.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseUrl(value: string, field: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
}
