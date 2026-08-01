import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { rateLimit } from "./rate-limit";

function fakeRedis(evalImpl: (...args: unknown[]) => Promise<unknown>): Redis {
  return { eval: vi.fn(evalImpl) } as unknown as Redis;
}

const POLICY = { limit: 3, windowMs: 60_000 };

describe("rateLimit", () => {
  it("allows requests under the limit", async () => {
    const redis = fakeRedis(async () => [1, 60_000]);
    const result = await rateLimit(redis, "login:1.2.3.4", POLICY);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks requests over the limit and reports retry time", async () => {
    const redis = fakeRedis(async () => [4, 42_000]);
    const result = await rateLimit(redis, "login:1.2.3.4", POLICY);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(42_000);
  });

  it("fails CLOSED by default when Redis is down", async () => {
    const redis = fakeRedis(async () => {
      throw new Error("connection refused");
    });
    const result = await rateLimit(redis, "login:1.2.3.4", POLICY);
    expect(result.allowed).toBe(false);
  });

  it("can fail open for non-critical paths", async () => {
    const redis = fakeRedis(async () => {
      throw new Error("connection refused");
    });
    const result = await rateLimit(redis, "api:1.2.3.4", POLICY, { failOpen: true });
    expect(result.allowed).toBe(true);
  });

  it("namespaces keys with a ratelimit prefix", async () => {
    const redis = fakeRedis(async () => [1, 1000]);
    await rateLimit(redis, "login:1.2.3.4", POLICY);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "ratelimit:login:1.2.3.4",
      POLICY.windowMs,
    );
  });
});
