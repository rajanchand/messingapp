import { Redis } from "ioredis";

let redis: Redis | undefined;

/**
 * Lazily created singleton. Reads REDIS_URL at first use so that build-time
 * module evaluation never requires a live Redis.
 */
export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set");
    }
    redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      // Queue commands while the initial connection is being established so
      // the first request after boot does not spuriously fail; commands still
      // error out quickly once the connection is confirmed down.
      enableOfflineQueue: true,
      connectTimeout: 5_000,
    });
    redis.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
  }
  return redis;
}
