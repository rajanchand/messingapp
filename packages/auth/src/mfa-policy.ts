import type { Permission } from "@zts/database";

/**
 * Permissions that imply high privilege on the admin panel.
 * Holders must enroll MFA (TOTP and/or passkey) before a session is issued
 * and before privileged API routes succeed.
 */
export const MFA_REQUIRED_PERMISSIONS: readonly Permission[] = [
  "users.create",
  "users.update",
  "users.disable",
  "users.delete",
  "rooms.create",
  "rooms.update",
  "rooms.delete",
  "rooms.moderate",
  "reports.manage",
  "media.manage",
  "federation.manage",
  "security.manage",
  "automation.create",
  "automation.execute",
  "automation.delete",
  "integrations.manage",
  "roles.manage",
  "settings.manage",
  "approvals.manage",
] as const;

export function permissionsRequireMfa(permissions: Iterable<Permission>): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  for (const p of MFA_REQUIRED_PERMISSIONS) {
    if (set.has(p)) return true;
  }
  return false;
}
