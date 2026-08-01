import "server-only";
import pino from "pino";

/**
 * Structured application logger. Redaction paths guarantee that secrets and
 * credentials never end up in log output even if passed accidentally.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "password",
      "*.password",
      "newPassword",
      "*.newPassword",
      "currentPassword",
      "*.currentPassword",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  base: { service: "zts-admin" },
});
