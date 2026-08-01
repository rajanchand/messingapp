/**
 * Canonical catalog of permissions and system roles.
 * Pure data - consumed by the seed script and by @zts/security.
 */

export const PERMISSIONS = {
  "users.read": "View users, their devices, sessions and rooms",
  "users.create": "Create and invite users",
  "users.update": "Update user profiles, display names and passwords",
  "users.disable": "Suspend, deactivate and reactivate users",
  "users.delete": "Permanently deactivate/erase users",
  "rooms.read": "View rooms, members and room state",
  "rooms.create": "Create rooms and spaces",
  "rooms.update": "Update room settings, aliases and topics",
  "rooms.delete": "Delete or shut down rooms",
  "rooms.moderate": "Moderate rooms: kick, ban, remove messages",
  "security.read": "View the security centre, sessions and security events",
  "security.manage": "Manage security policies, revoke sessions, block IPs",
  "audit.read": "Read and export audit logs",
  "automation.read": "View automation workflows and execution history",
  "automation.create": "Create and edit automation workflows",
  "automation.execute": "Manually execute automation workflows",
  "automation.delete": "Delete automation workflows",
  "integrations.read": "View integrations and their status",
  "integrations.manage": "Connect, configure and disconnect integrations",
  "roles.read": "View roles and permission assignments",
  "roles.manage": "Assign and revoke roles",
  "settings.read": "View platform settings",
  "settings.manage": "Change platform settings and branding",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface SystemRoleDefinition {
  slug: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    slug: "super_admin",
    name: "Super Admin",
    description: "Full system control.",
    permissions: ALL_PERMISSIONS,
  },
  {
    slug: "security_admin",
    name: "Security Admin",
    description: "Security settings, audit logs, sessions, bans and security policies.",
    permissions: [
      "security.read",
      "security.manage",
      "audit.read",
      "users.read",
      "users.disable",
      "roles.read",
    ],
  },
  {
    slug: "user_admin",
    name: "User Admin",
    description: "User creation, suspension, deactivation and password operations.",
    permissions: [
      "users.read",
      "users.create",
      "users.update",
      "users.disable",
      "roles.read",
      "roles.manage",
    ],
  },
  {
    slug: "room_admin",
    name: "Room Admin",
    description: "Room management and moderation.",
    permissions: ["rooms.read", "rooms.create", "rooms.update", "rooms.delete", "rooms.moderate"],
  },
  {
    slug: "moderator",
    name: "Moderator",
    description: "Moderation and user reports.",
    permissions: ["rooms.read", "rooms.moderate", "users.read"],
  },
  {
    slug: "automation_admin",
    name: "Automation Admin",
    description: "Create and manage automation workflows.",
    permissions: [
      "automation.read",
      "automation.create",
      "automation.execute",
      "automation.delete",
      "integrations.read",
    ],
  },
  {
    slug: "auditor",
    name: "Auditor",
    description: "Read-only access to audit logs and reports.",
    permissions: ["audit.read", "security.read", "users.read", "rooms.read"],
  },
  {
    slug: "user",
    name: "Normal User",
    description: "Only normal collaboration features; no admin panel permissions.",
    permissions: [],
  },
];
