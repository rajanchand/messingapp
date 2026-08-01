import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, notificationPreferences } from "@zts/database";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";

const defaults = {
  securityAlerts: true,
  workflowFailures: true,
  userCreation: true,
  serverHealth: true,
  integrationErrors: true,
  channelInApp: true,
  channelEmail: false,
  channelMatrix: false,
  channelSlack: false,
};

export const GET = createApiHandler({ rateLimit: "api" }, async ({ auth }) => {
  const db = getDb();
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, auth.user.id));
  return jsonOk({ preferences: row ?? { userId: auth.user.id, ...defaults } });
});

const bodySchema = z.object({
  securityAlerts: z.boolean().optional(),
  workflowFailures: z.boolean().optional(),
  userCreation: z.boolean().optional(),
  serverHealth: z.boolean().optional(),
  integrationErrors: z.boolean().optional(),
  channelInApp: z.boolean().optional(),
  channelEmail: z.boolean().optional(),
  channelMatrix: z.boolean().optional(),
  channelSlack: z.boolean().optional(),
});

export const PUT = createApiHandler(
  { bodySchema, rateLimit: "mutation" },
  async ({ auth, body }) => {
    const db = getDb();
    const [row] = await db
      .insert(notificationPreferences)
      .values({
        userId: auth.user.id,
        ...defaults,
        ...body,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();
    return jsonOk({ preferences: row });
  },
);
