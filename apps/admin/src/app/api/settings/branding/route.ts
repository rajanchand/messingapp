import { z } from "zod";
import { eq } from "drizzle-orm";
import { appSettings, getDb } from "@zts/database";
import { writeAuditLog } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

const BRANDING_KEY = "branding";

const brandingSchema = z.object({
  appName: z.string().min(1).max(128).optional(),
  supportEmail: z.string().email().optional(),
  logoPath: z.string().min(1).max(512).optional(),
});

export const GET = createApiHandler(
  { permission: "settings.read", rateLimit: "api" },
  async () => {
    const env = getEnv();
    const row = (
      await getDb().select().from(appSettings).where(eq(appSettings.key, BRANDING_KEY)).limit(1)
    )[0];
    const stored = (row?.value ?? {}) as Record<string, unknown>;
    return jsonOk({
      branding: {
        appName: typeof stored.appName === "string" ? stored.appName : env.APP_NAME,
        supportEmail:
          typeof stored.supportEmail === "string" ? stored.supportEmail : env.SUPPORT_EMAIL,
        logoPath: typeof stored.logoPath === "string" ? stored.logoPath : env.APP_LOGO,
        source: row ? "database" : "env",
      },
      masOidc: {
        status: "deferred",
        endpoint: "/api/auth/oidc",
        notes: [
          "Admin-panel SSO/OIDC login UI shows a coming-soon affordance.",
          "Set ADMIN_OIDC_* env vars; POST /api/auth/oidc returns 501 until full IdP wiring.",
          "Element X / MAS remains the chat client identity path.",
          "See docs/MAS-OIDC.md.",
        ],
      },
    });
  },
);

export const PUT = createApiHandler(
  {
    permission: "settings.manage",
    requireSudo: true,
    bodySchema: brandingSchema,
    rateLimit: "mutation",
  },
  async ({ auth, body, ip, userAgent }) => {
    const db = getDb();
    const existing = (
      await db.select().from(appSettings).where(eq(appSettings.key, BRANDING_KEY)).limit(1)
    )[0];
    const prev = (existing?.value ?? {}) as Record<string, unknown>;
    const next = { ...prev, ...body };
    await db
      .insert(appSettings)
      .values({ key: BRANDING_KEY, value: next, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: next, updatedAt: new Date() },
      });
    await writeAuditLog(db, {
      actorId: auth.user.id,
      actor: auth.user.username,
      action: "BRANDING_UPDATED",
      target: BRANDING_KEY,
      ip,
      userAgent,
      metadata: { keys: Object.keys(body) },
    });
    return jsonOk({ branding: next });
  },
);
