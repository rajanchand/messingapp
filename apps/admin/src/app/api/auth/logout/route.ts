import { getDb } from "@zts/database";
import { revokeSession } from "@zts/auth";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { clearSessionCookie } from "@/lib/api/cookies";

export const POST = createApiHandler({}, async ({ auth }) => {
  await revokeSession(getDb(), auth.session.id);
  const res = jsonOk({ status: "ok" as const });
  clearSessionCookie(res);
  return res;
});
