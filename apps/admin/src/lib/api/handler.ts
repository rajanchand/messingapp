import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import type { Permission } from "@zts/database";
import { getDb, type schema } from "@zts/database";
import { validateSessionToken, verifyCsrfToken, isSudoActive } from "@zts/auth";
import {
  PermissionError,
  RATE_LIMITS,
  getRedis,
  getUserPermissions,
  rateLimit,
  requirePermission,
  type RateLimitPolicy,
} from "@zts/security";
import { SynapseError } from "@zts/matrix";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ApiError, jsonError } from "./http";
import { SESSION_COOKIE } from "./cookies";

export interface AuthInfo {
  user: typeof schema.adminUsers.$inferSelect;
  session: typeof schema.sessions.$inferSelect;
  permissions: Set<Permission>;
}

export interface BaseContext<TBody, TQuery> {
  req: NextRequest;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
  ip: string | null;
  userAgent: string | null;
}

export interface ApiContext<TBody, TQuery> extends BaseContext<TBody, TQuery> {
  auth: AuthInfo;
}

export interface PublicApiContext<TBody, TQuery> extends BaseContext<TBody, TQuery> {
  auth: AuthInfo | null;
}

interface SharedOptions<TBody, TQuery> {
  bodySchema?: z.ZodType<TBody>;
  querySchema?: z.ZodType<TQuery>;
  /** Named policy or custom policy; keyed by client IP. */
  rateLimit?: keyof typeof RATE_LIMITS | RateLimitPolicy;
  /** Name used in rate limit keys; defaults to the policy name. */
  rateLimitName?: string;
}

interface AuthedOptions<TBody, TQuery> extends SharedOptions<TBody, TQuery> {
  /** Required permission, enforced server-side after authentication. */
  permission?: Permission;
  /** Require an active sudo-mode session (recent re-authentication). */
  requireSudo?: boolean;
}

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

export function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Non-browser clients; the CSRF token is still required.
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

async function resolveAuth(req: NextRequest): Promise<AuthInfo | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const valid = await validateSessionToken(db, token);
  if (!valid) return null;
  const permissions = await getUserPermissions(db, valid.user.id);
  return { user: valid.user, session: valid.session, permissions };
}

async function applyRateLimit<TBody, TQuery>(
  req: NextRequest,
  ip: string | null,
  options: SharedOptions<TBody, TQuery>,
  isPublic: boolean,
): Promise<NextResponse | null> {
  if (!options.rateLimit) return null;
  const policy =
    typeof options.rateLimit === "string" ? RATE_LIMITS[options.rateLimit] : options.rateLimit;
  const name =
    options.rateLimitName ?? (typeof options.rateLimit === "string" ? options.rateLimit : "custom");
  const result = await rateLimit(getRedis(), `${name}:${ip ?? "unknown"}`, policy, {
    // Authenticated read traffic may proceed during a Redis blip;
    // unauthenticated/auth-critical paths fail closed.
    failOpen: !isPublic && options.rateLimit === "api",
  });
  if (!result.allowed) {
    return jsonError(429, "rate_limited", "Too many requests. Please slow down.", {
      retryAfterMs: result.retryAfterMs,
    });
  }
  return null;
}

async function parseInputs<TBody, TQuery>(
  req: NextRequest,
  options: SharedOptions<TBody, TQuery>,
): Promise<{ body: TBody; query: TQuery } | NextResponse> {
  let body = undefined as TBody;
  if (options.bodySchema) {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, "invalid_json", "Request body must be valid JSON.");
    }
    const parsed = options.bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "validation", "Invalid request body.", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    body = parsed.data;
  }

  let query = undefined as TQuery;
  if (options.querySchema) {
    const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = options.querySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "validation", "Invalid query parameters.", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    query = parsed.data;
  }

  return { body, query };
}

function toErrorResponse(err: unknown, req: NextRequest): NextResponse {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.code, err.message);
  }
  if (err instanceof PermissionError) {
    return jsonError(403, "forbidden", "You do not have permission to perform this action.");
  }
  if (err instanceof SynapseError) {
    logger.error(
      { status: err.status, errcode: err.errcode, path: req.nextUrl.pathname },
      "Synapse API error",
    );
    return jsonError(
      err.status === 404 ? 404 : 502,
      "synapse_error",
      err.status === 404 ? "Not found on the homeserver." : "Homeserver request failed.",
    );
  }
  // Never leak stack traces or internal details to clients.
  logger.error({ err, path: req.nextUrl.pathname }, "Unhandled API error");
  return jsonError(500, "internal", "An internal error occurred.");
}

/**
 * Authenticated route wrapper. Security pipeline, all server-side:
 * rate limiting -> authentication -> CSRF -> RBAC -> sudo -> validation.
 */
export function createApiHandler<TBody = unknown, TQuery = unknown>(
  options: AuthedOptions<TBody, TQuery>,
  fn: (ctx: ApiContext<TBody, TQuery>) => Promise<NextResponse>,
): RouteHandler {
  return async (req, routeCtx) => {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");
    try {
      const limited = await applyRateLimit(req, ip, options, false);
      if (limited) return limited;

      const auth = await resolveAuth(req);
      if (!auth) {
        return jsonError(401, "unauthenticated", "Authentication required.");
      }

      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (!checkOrigin(req)) {
          return jsonError(403, "bad_origin", "Cross-origin request rejected.");
        }
        const csrfHeader = req.headers.get("x-csrf-token");
        if (
          !csrfHeader ||
          !verifyCsrfToken(getEnv().SESSION_SECRET, auth.session.tokenHash, csrfHeader)
        ) {
          return jsonError(403, "csrf", "Invalid or missing CSRF token.");
        }
      }

      if (options.permission) {
        requirePermission(auth.permissions, options.permission);
      }

      if (options.requireSudo && !isSudoActive(auth.session)) {
        return jsonError(403, "sudo_required", "Re-authentication required for this action.");
      }

      const inputs = await parseInputs(req, options);
      if (inputs instanceof Response) return inputs as NextResponse;

      const params = (await routeCtx.params) ?? {};
      return await fn({ req, params, body: inputs.body, query: inputs.query, ip, userAgent, auth });
    } catch (err) {
      return toErrorResponse(err, req);
    }
  };
}

/** Public route wrapper (login, health). No session required. */
export function createPublicApiHandler<TBody = unknown, TQuery = unknown>(
  options: SharedOptions<TBody, TQuery>,
  fn: (ctx: PublicApiContext<TBody, TQuery>) => Promise<NextResponse>,
): RouteHandler {
  return async (req, routeCtx) => {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");
    try {
      const limited = await applyRateLimit(req, ip, options, true);
      if (limited) return limited;

      const auth = await resolveAuth(req);

      const inputs = await parseInputs(req, options);
      if (inputs instanceof Response) return inputs as NextResponse;

      const params = (await routeCtx.params) ?? {};
      return await fn({ req, params, body: inputs.body, query: inputs.query, ip, userAgent, auth });
    } catch (err) {
      return toErrorResponse(err, req);
    }
  };
}
