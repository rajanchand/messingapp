import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Platform admin accounts. These are accounts for the admin panel itself and
 * are entirely separate from Matrix accounts on the homeserver.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    email: text("email").unique(),
    displayName: text("display_name"),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_users_username_idx").on(t.username)],
);

/**
 * Server-side sessions. Only a SHA-256 hash of the opaque session token is
 * stored; the raw token lives exclusively in an HttpOnly cookie.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Until when the session is in "sudo mode" (recent re-authentication). */
    sudoUntil: timestamp("sudo_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** System roles are seeded and cannot be deleted from the UI. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Permission strings such as "users.read". The id IS the permission string. */
export const permissions = pgTable("permissions", {
  id: text("id").primaryKey(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => adminUsers.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/**
 * Roles assigned to Matrix users (users on the homeserver, identified by
 * their full Matrix ID). Lets the panel grant platform roles to Matrix
 * accounts without requiring a separate admin account.
 */
export const matrixUserRoles = pgTable(
  "matrix_user_roles",
  {
    matrixUserId: text("matrix_user_id").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => adminUsers.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.matrixUserId, t.roleId] })],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    userId: uuid("user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    success: boolean("success").notNull(),
    /** Machine-readable failure reason, e.g. "bad_password", "locked", "mfa_failed". */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_attempts_username_idx").on(t.username),
    index("login_attempts_created_idx").on(t.createdAt),
  ],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "ACCOUNT_LOCKED", "MFA_ENABLED", "SESSION_REVOKED", "RATE_LIMITED" */
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    userId: uuid("user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("security_events_type_idx").on(t.type),
    index("security_events_created_idx").on(t.createdAt),
  ],
);

/**
 * Append-only audit trail. Application code exposes no update/delete paths,
 * and the migration revokes UPDATE/DELETE from the application role where
 * database privileges allow it.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),
    /** Human-readable actor, e.g. "@admin:chat.zero-trust-security.org" or username. */
    actor: text("actor").notNull(),
    /** e.g. "USER_CREATED", "USER_DEACTIVATED", "PASSWORD_RESET" */
    action: text("action").notNull(),
    target: text("target"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    result: text("result").notNull().default("success"),
    /** Never contains passwords, tokens, secrets or message contents. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_actor_idx").on(t.actor),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

/** TOTP credentials. The secret is encrypted (AES-256-GCM) before storage. */
export const mfaCredentials = pgTable("mfa_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("totp"),
  encryptedSecret: text("encrypted_secret").notNull(),
  /** Set once the user has confirmed a valid code; unverified secrets are not usable. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

/** Central branding / app settings, editable by Super Admins. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** IP addresses/CIDRs blocked from the admin panel (security centre). */
export const ipBlocks = pgTable(
  "ip_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Exact IP or CIDR notation. */
    cidr: text("cidr").notNull().unique(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("ip_blocks_created_idx").on(t.createdAt)],
);

/** Per-admin-user notification channel preferences. */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  securityAlerts: boolean("security_alerts").notNull().default(true),
  workflowFailures: boolean("workflow_failures").notNull().default(true),
  userCreation: boolean("user_creation").notNull().default(true),
  serverHealth: boolean("server_health").notNull().default(true),
  integrationErrors: boolean("integration_errors").notNull().default(true),
  /** Delivery channels: in_app always on; matrix/email/slack optional. */
  channelInApp: boolean("channel_in_app").notNull().default(true),
  channelEmail: boolean("channel_email").notNull().default(false),
  channelMatrix: boolean("channel_matrix").notNull().default(false),
  channelSlack: boolean("channel_slack").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** In-app notifications for admin users. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    metadata: jsonb("metadata"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_created_idx").on(t.createdAt),
  ],
);

/** WebAuthn / passkey credentials. Public key + credential ID only (no secrets). */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports"),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    nickname: text("nickname"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("webauthn_credentials_user_idx").on(t.userId)],
);

/**
 * Encrypted Matrix bot access token used for outbound notifications /
 * automation messages. Never exposed to the browser.
 */
export const matrixBotSettings = pgTable("matrix_bot_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  matrixUserId: text("matrix_user_id").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Phase 3: automation ---

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(false),
    /** Trigger type from the automation catalog, e.g. USER_CREATED. */
    triggerType: text("trigger_type").notNull(),
    /** JSON definition: { conditions, actions, schedule? }. */
    definition: jsonb("definition").notNull(),
    version: integer("version").notNull().default(1),
    ownerId: uuid("owner_id").references(() => adminUsers.id, { onDelete: "set null" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflows_trigger_idx").on(t.triggerType),
    index("workflows_enabled_idx").on(t.enabled),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_versions_workflow_idx").on(t.workflowId)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("pending"),
    triggerType: text("trigger_type").notNull(),
    triggerPayload: jsonb("trigger_payload"),
    idempotencyKey: text("idempotency_key"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflow_runs_workflow_idx").on(t.workflowId),
    index("workflow_runs_status_idx").on(t.status),
    index("workflow_runs_idempotency_idx").on(t.idempotencyKey),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    actionType: text("action_type").notNull(),
    status: text("status").notNull().default("pending"),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("workflow_run_steps_run_idx").on(t.runId)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Public path segment / secret id for inbound URL. */
    slug: text("slug").notNull().unique(),
    /** HMAC secret hashed at rest (SHA-256). Raw secret shown once on create. */
    secretHash: text("secret_hash").notNull(),
    /** Encrypted raw secret for outbound signing verification helpers. */
    encryptedSecret: text("encrypted_secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Optional workflow to trigger on inbound delivery. */
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    ipAllowlist: jsonb("ip_allowlist"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_slug_idx").on(t.slug)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(),
    status: text("status").notNull(),
    httpStatus: integer("http_status"),
    requestId: text("request_id"),
    payloadHash: text("payload_hash"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_created_idx").on(t.createdAt),
  ],
);

// --- Phase 4: integrations ---

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Adapter type: slack, github, email, discord, jira, webhook. */
    type: text("type").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    status: text("status").notNull().default("disconnected"),
    config: jsonb("config"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("integrations_type_idx").on(t.type)],
);

export const integrationSecrets = pgTable("integration_secrets", {
  integrationId: uuid("integration_id")
    .primaryKey()
    .references(() => integrations.id, { onDelete: "cascade" }),
  /** AES-GCM ciphertext of the credential blob. */
  encryptedBlob: text("encrypted_blob").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationLogs = pgTable(
  "integration_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("integration_logs_integration_idx").on(t.integrationId),
    index("integration_logs_created_idx").on(t.createdAt),
  ],
);

// --- Phase 5: AI proposals ---

export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_proposals_user_idx").on(t.userId),
    index("ai_proposals_status_idx").on(t.status),
  ],
);

/**
 * Org profile metadata for Matrix users. Synapse remains authoritative for
 * auth identity; this table stores HR-style fields the panel collects at
 * create time (department, phone, employee id, etc.).
 */
export const matrixUserProfiles = pgTable(
  "matrix_user_profiles",
  {
    matrixUserId: text("matrix_user_id").primaryKey(),
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    /** Free-text employee / badge id so admins can identify the person easily. */
    employeeId: text("employee_id"),
    department: text("department"),
    subdepartment: text("subdepartment"),
    /** Platform role slug assigned at create (also mirrored in matrix_user_roles). */
    primaryRoleSlug: text("primary_role_slug"),
    createdBy: uuid("created_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matrix_user_profiles_email_idx").on(t.email),
    index("matrix_user_profiles_employee_idx").on(t.employeeId),
    index("matrix_user_profiles_department_idx").on(t.department),
  ],
);
