import { z } from "zod";
import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { auditLogs, getDb } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const querySchema = z.object({
  actor: z.string().max(255).optional(),
  action: z.string().max(128).optional(),
  target: z.string().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Searchable, filterable, append-only audit trail. Read requires audit.read. */
export const GET = createApiHandler(
  { permission: "audit.read", querySchema, rateLimit: "api" },
  async ({ query }) => {
    const db = getDb();
    const conditions = [];
    if (query.actor) conditions.push(ilike(auditLogs.actor, `%${query.actor}%`));
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.target) conditions.push(ilike(auditLogs.target, `%${query.target}%`));
    if (query.from) conditions.push(gte(auditLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(auditLogs.createdAt, query.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [entries, totalRows] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(query.limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where),
    ]);

    return jsonOk({
      entries,
      total: Number(totalRows[0]?.count ?? 0),
      page: query.page,
      limit: query.limit,
    });
  },
);
