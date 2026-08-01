import { z } from "zod";
import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { auditLogs, getDb } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { NextResponse } from "next/server";

const MAX_EXPORT = 10_000;

const querySchema = z.object({
  actor: z.string().max(255).optional(),
  action: z.string().max(128).optional(),
  target: z.string().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(["csv", "json"]).default("json"),
  limit: z.coerce.number().int().min(1).max(MAX_EXPORT).default(MAX_EXPORT),
});

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Export filtered audit rows as CSV or JSON (capped). Permission: audit.read. */
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

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where);
    const total = Number(totalRows[0]?.count ?? 0);
    if (total > MAX_EXPORT && query.limit >= MAX_EXPORT) {
      // Still export up to cap; clients should narrow filters.
    }

    const entries = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.limit);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (query.format === "json") {
      return new NextResponse(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            totalMatching: total,
            exported: entries.length,
            cappedAt: MAX_EXPORT,
            entries,
          },
          null,
          2,
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="audit-export-${stamp}.json"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const header = ["id", "createdAt", "actor", "action", "target", "ip", "result", "userAgent"];
    const lines = [
      header.join(","),
      ...entries.map((e) =>
        [
          e.id,
          e.createdAt.toISOString(),
          e.actor,
          e.action,
          e.target ?? "",
          e.ip ?? "",
          e.result,
          e.userAgent ?? "",
        ]
          .map((v) => csvEscape(String(v)))
          .join(","),
      ),
    ];

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Export-Total-Matching": String(total),
        "X-Export-Count": String(entries.length),
      },
    });
  },
);
