import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, notifications } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { z } from "zod";

export const GET = createApiHandler({ rateLimit: "api" }, async ({ auth }) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, auth.user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const [unread] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));

  return jsonOk({
    notifications: rows,
    unread: Number(unread?.count ?? 0),
  });
});

const markBodySchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  all: z.boolean().optional(),
});

export const POST = createApiHandler(
  { bodySchema: markBodySchema, rateLimit: "mutation" },
  async ({ auth, body }) => {
    const db = getDb();
    if (body.all) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
    } else if (body.ids?.length) {
      for (const id of body.ids) {
        await db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)));
      }
    }
    return jsonOk({ ok: true });
  },
);
