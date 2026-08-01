import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

function createDb(url: string) {
  const client = postgres(url, {
    max: 10,
    // Fail fast instead of hanging when the database is unreachable.
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

let db: Database | undefined;

/**
 * Lazily created singleton. Reads DATABASE_URL at first use so that
 * build-time module evaluation never requires a live database.
 */
export function getDb(): Database {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    db = createDb(url);
  }
  return db;
}
