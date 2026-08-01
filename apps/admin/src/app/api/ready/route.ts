import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@zts/database";
import { getRedis } from "@zts/security";

/**
 * Readiness probe: verifies the app can reach its own database and Redis.
 * Returns only boolean statuses - no connection details or errors.
 */
export async function GET() {
  const [dbOk, redisOk] = await Promise.all([
    getDb()
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    getRedis()
      .ping()
      .then(() => true)
      .catch(() => false),
  ]);
  const ready = dbOk && redisOk;
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", database: dbOk, redis: redisOk },
    { status: ready ? 200 : 503 },
  );
}
