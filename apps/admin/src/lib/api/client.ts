"use client";

/**
 * Client-side API helper. Sends the CSRF token (obtained from /api/auth/me)
 * on every mutation. Session tokens live in HttpOnly cookies and are never
 * accessible from this code.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
  retryAfterMs?: number;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiErrorPayload,
  ) {
    super(payload.message);
    this.name = "ApiClientError";
  }

  get code(): string {
    return this.payload.code;
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  let json: { ok: boolean; data?: T; error?: ApiErrorPayload };
  try {
    json = await response.json();
  } catch {
    throw new ApiClientError(response.status, {
      code: "bad_response",
      message: "Unexpected server response.",
    });
  }

  if (!response.ok || !json.ok) {
    throw new ApiClientError(
      response.status,
      json.error ?? { code: "unknown", message: "Request failed." },
    );
  }
  return json.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  delete: <T>(url: string, body?: unknown) => request<T>("DELETE", url, body),
};
