# Architecture

## Principles

1. **Synapse stays authoritative.** The admin panel is a management/automation layer that
   talks to Synapse exclusively through official Admin/Client APIs. It never reads or writes
   the Synapse PostgreSQL database.
2. **Zero trust.** Every API request is authenticated, authorized (RBAC), rate limited and
   validated server-side. Client-side checks are UX only.
3. **E2EE is sacred.** Nothing in this platform attempts to read or weaken end-to-end
   encrypted content. Only metadata and server capabilities exposed by Synapse are managed.
4. **Additive deployment.** The platform adds new containers (`zts-admin`, `zts-postgres`,
   `zts-redis`) beside the existing `matrix-synapse` / `matrix-postgres` containers. Existing
   volumes, networks and configs are never modified or deleted.

## Topology

```text
Internet
   |
   v
Reverse proxy :443 (TLS, HSTS, rate limits)
   |----------------------------- chat.zero-trust-security.org --> matrix-synapse :8008 (existing)
   |----------------------------- admin.chat.zero-trust-security.org --> zts-admin :3000
                                                                          |
                                        +---------------------------------+
                                        |                |                |
                                        v                v                v
                                  zts-postgres      zts-redis      Synapse Admin API
                                  (app data)     (rate limits)     (users, devices, rooms)

Element X clients ---> chat.zero-trust-security.org ---> matrix-synapse ---> matrix-postgres
```

## Monorepo

pnpm workspaces + Turborepo. Internal packages are consumed as TypeScript source via Next.js
`transpilePackages` - no separate build step.

| Package | Responsibility |
| --- | --- |
| `apps/admin` | Next.js 16 UI + API route handlers |
| `packages/database` | Drizzle schema/migrations, DB client, RBAC catalog (pure data) |
| `packages/auth` | Argon2id, opaque sessions, TOTP, WebAuthn, recovery codes, CSRF primitives |
| `packages/security` | RBAC resolution + guards, Redis rate limiter, audit/security-event writers, IP block matching |
| `packages/matrix` | Typed Synapse Admin API client with retry/backoff (users, devices, rooms, moderation) |
| `packages/automation` | Trigger/action catalogs, condition eval, safety limits, BullMQ enqueue |
| `packages/integrations` | Adapter interface + Slack/GitHub/Email/Discord/Jira/Webhook adapters |
| `packages/ai` | LLM provider (OpenAI-compatible), read-only tools, propose-confirm, workflow drafts |
| `workers/automation` | BullMQ consumers for automation / notifications / webhooks / email |

## Request pipeline

Every API route is wrapped by `createApiHandler` (`apps/admin/src/lib/api/handler.ts`):

```text
rate limit (Redis, fail-closed)
  -> session authentication (HttpOnly cookie -> hashed token lookup)
  -> CSRF (Origin check + HMAC double-submit token) for mutations
  -> RBAC permission check
  -> sudo-mode check for dangerous operations
  -> Zod input validation
  -> handler
  -> normalized error responses (never leak stack traces)
```

## Data model (application database)

- `admin_users`, `sessions` - panel accounts and server-side sessions (token hashes only).
- `roles`, `permissions`, `role_permissions`, `user_roles`, `matrix_user_roles` - RBAC.
- `login_attempts`, `security_events` - security telemetry.
- `audit_logs` - append-only audit trail (no update/delete code paths).
- `mfa_credentials` (AES-256-GCM encrypted TOTP seeds), `recovery_codes` (hashes only).
- `webauthn_credentials`, `ip_blocks`, `notifications`, `notification_preferences`, `matrix_bot_settings`.
- `workflows`, `workflow_versions`, `workflow_runs`, `workflow_run_steps`, `webhook_endpoints`, `webhook_deliveries`.
- `integrations`, `integration_secrets`, `integration_logs`.
- `ai_proposals` - pending privileged actions from the assistant.
- `app_settings` - branding/config overrides.

## Phase roadmap

| Phase | Scope |
| --- | --- |
| 1 (done) | Bootstrap, auth, RBAC, dashboard, Synapse connection, user management |
| 2 (done) | Rooms, moderation, security centre, notifications, WebAuthn |
| 3 (done) | Automation engine, BullMQ workers, workflow builder, webhooks |
| 4 (done) | Slack, GitHub, Email, Discord, Jira integrations (adapter framework) |
| 5 (done) | AI assistant, AI-assisted automation drafts, analytics hooks |
| 6 | CI/CD to GHCR, VPS deployment, monitoring, encrypted off-site backups, DR |

Phases 2–5 packages and workers are implemented in-tree; Phase 6 remains deployment hardening.

## Packages (Phases 2–5)

| Package | Responsibility |
| --- | --- |
| `packages/automation` | Trigger/action catalogs, condition eval, safety limits, BullMQ enqueue |
| `packages/integrations` | Adapter interface + Slack/GitHub/Email/Discord/Jira/Webhook adapters |
| `packages/ai` | LLM provider (OpenAI-compatible + stub), read-only tools, propose-confirm |
| `workers/automation` | BullMQ consumer executing workflow actions |

## Automation pipeline

```text
Admin API mutation
  -> writeAuditLog
  -> dispatchTriggerSafe (non-blocking)
      -> match enabled workflows + conditions
      -> insert workflow_runs (idempotency key)
      -> BullMQ job
          -> worker executes actions (NOTIFY_ADMIN, SEND_SLACK, …)
```

Safety: max 20 actions/run, 30s timeout, cascade depth ≤3, self-loop detection, idempotency keys.

## AI assistant

Read-only tools query stats/audit/security/workflows/integrations. Privileged actions create
`ai_proposals` rows; operators approve via `/assistant` with sudo. Element X remains the chat client.
