import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only used by drizzle-kit CLI commands, never bundled.
    url: process.env.DATABASE_URL ?? "postgres://zts:change-me@localhost:5433/zts",
  },
  strict: true,
  verbose: true,
});
