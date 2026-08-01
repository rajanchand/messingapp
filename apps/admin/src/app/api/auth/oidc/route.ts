import { createPublicApiHandler } from "@/lib/api/handler";
import { jsonOk, jsonError } from "@/lib/api/http";

/**
 * Admin SSO / OIDC status. Full IdP login is deferred; this surface exposes
 * configuration readiness so the login UI can show a clear "coming soon" or
 * "not configured" affordance without shipping a half-broken OIDC flow.
 */
export const GET = createPublicApiHandler({ rateLimit: "api" }, async () => {
  const issuer = process.env.ADMIN_OIDC_ISSUER?.trim() || "";
  const clientId = process.env.ADMIN_OIDC_CLIENT_ID?.trim() || "";
  const enabledFlag = process.env.ADMIN_OIDC_ENABLED === "true";
  const configured = Boolean(issuer && clientId);
  const enabled = enabledFlag && configured;

  return jsonOk({
    status: enabled ? ("ready" as const) : ("deferred" as const),
    enabled,
    configured,
    issuer: configured ? issuer : null,
    clientIdConfigured: Boolean(clientId),
    label: enabled
      ? "Continue with SSO"
      : configured
        ? "SSO configured but disabled"
        : "Single sign-on (coming soon)",
    hint: enabled
      ? "OIDC login endpoint is reserved; complete IdP wiring before enabling traffic."
      : "Set ADMIN_OIDC_* in .env and see docs/MAS-OIDC.md. Local password + MFA remains the break-glass path.",
  });
});

/** Stub begin endpoint — returns 501 until full OIDC is implemented. */
export const POST = createPublicApiHandler({ rateLimit: "login" }, async () => {
  return jsonError(
    501,
    "not_implemented",
    "Admin OIDC login is not enabled yet. Use username/password + MFA, or see docs/MAS-OIDC.md.",
  );
});
