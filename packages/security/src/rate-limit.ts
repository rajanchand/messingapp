import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

export interface RateLimitPolicy {
  /** Maximum requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Sensible default policies, keyed for reuse across routes. */
export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 5 * 60 * 1000 },
  /** TOTP / recovery-code verification — tighter than password login. */
  mfa: { limit: 5, windowMs: 5 * 60 * 1000 },
  sudo: { limit: 10, windowMs: 5 * 60 * 1000 },
  api: { limit: 300, windowMs: 60 * 1000 },
  mutation: { limit: 60, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

const SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`;

/**
 * Fixed-window rate limiter backed by Redis. Fails CLOSED for auth-critical
 * paths: callers decide via `failOpen` whether Redis outages block requests.
 */
export async function rateLimit(
  redis: Redis,
  key: string,
  policy: RateLimitPolicy,
  { failOpen = false }: { failOpen?: boolean } = {},
): Promise<RateLimitResult> {
  try {
    const result = (await redis.eval(SCRIPT, 1, `ratelimit:${key}`, policy.windowMs)) as [
      number,
      number,
    ];
    const [current, ttl] = result;
    return {
      allowed: current <= policy.limit,
      remaining: Math.max(0, policy.limit - current),
      retryAfterMs: Math.max(0, ttl),
    };
  } catch {
    return failOpen
      ? { allowed: true, remaining: 0, retryAfterMs: 0 }
      : { allowed: false, remaining: 0, retryAfterMs: policy.windowMs };
  }
}
