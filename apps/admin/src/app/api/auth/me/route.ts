import { getDb } from "@zts/database";
import { deriveCsrfToken, isSudoActive } from "@zts/auth";
import { getUserRoles } from "@zts/security";
import { createApiHandler } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/http";
import { getEnv } from "@/lib/env";

/** Current session info. Also provides the CSRF token for mutations. */
export const GET = createApiHandler({}, async ({ auth }) => {
  const roles = await getUserRoles(getDb(), auth.user.id);
  return jsonOk({
    user: {
      id: auth.user.id,
      username: auth.user.username,
      displayName: auth.user.displayName,
      email: auth.user.email,
      mfaEnabled: auth.user.mfaEnabled,
      lastLoginAt: auth.user.lastLoginAt,
    },
    roles,
    permissions: [...auth.permissions],
    csrfToken: deriveCsrfToken(getEnv().SESSION_SECRET, auth.session.tokenHash),
    sudoActive: isSudoActive(auth.session),
    sessionCreatedAt: auth.session.createdAt,
  });
});
