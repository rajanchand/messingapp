import { getDb } from "@zts/database";
import { startTotpEnrollment } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

/** Starts TOTP enrollment. Returns otpauth URL + secret exactly once. */
export const POST = createApiHandler({ rateLimit: "sudo", requireSudo: true }, async ({ auth }) => {
  const env = getEnv();
  const enrollment = await startTotpEnrollment(
    getDb(),
    env.SESSION_SECRET,
    auth.user.id,
    env.APP_NAME,
    auth.user.username,
  );
  return jsonOk(enrollment);
});
