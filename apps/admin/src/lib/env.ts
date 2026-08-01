import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  APP_NAME: z.string().min(1).default("Zero Trust Security"),
  APP_LOGO: z.string().min(1).default("/branding/logo.svg"),
  APP_FAVICON: z.string().min(1).default("/branding/favicon.svg"),
  SUPPORT_EMAIL: z.string().email().default("support@zero-trust-security.org"),
  ADMIN_DOMAIN: z.string().min(1).default("localhost:3000"),
  MATRIX_HOMESERVER: z.string().url(),
  MATRIX_SERVER_NAME: z.string().min(1),
  MATRIX_ADMIN_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters of high-entropy data"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_ORIGIN: z.string().url().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AUTOMATION_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  ELEMENT_X_HINT_URL: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Lazy so that `next build` does not require
 * production secrets; the first real request fails loudly if misconfigured.
 */
export function getEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}
