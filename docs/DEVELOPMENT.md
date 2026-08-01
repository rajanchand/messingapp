# Development

## Prerequisites

- Node.js 22+
- pnpm 9 (`corepack enable`)
- Docker + Docker Compose

## Setup

```bash
pnpm install
make up                      # zts-postgres on :5433, zts-redis on :6380
cp .env.example .env         # fill in values (see below)
set -a && source .env && set +a
make migrate                 # apply Drizzle migrations
make seed                    # seed roles + permissions
make bootstrap-admin         # create the first Super Admin
make dev                     # http://localhost:3000
```

### Required environment variables

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgres://zts:change-me@localhost:5433/zts` for the dev compose stack |
| `REDIS_URL` | `redis://localhost:6380` for the dev compose stack |
| `SESSION_SECRET` | `openssl rand -base64 48` - rotating it invalidates sessions and TOTP seeds |
| `MATRIX_HOMESERVER` | e.g. `https://chat.zero-trust-security.org` |
| `MATRIX_SERVER_NAME` | e.g. `chat.zero-trust-security.org` |
| `MATRIX_ADMIN_TOKEN` | Access token of a Synapse **admin** account (server-side only) |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Optional OpenAI-compatible assistant; heuristics work without them |

To obtain an admin token on the homeserver, log in as an admin user and copy its access
token, or create an admin account with `register_new_matrix_user -a` and log in once.

Without a reachable Synapse, the app still runs: dashboard cards and the users page will
show error/empty states, while auth, RBAC, audit and settings work fully.

### Mock Synapse for local development

To exercise the full user-management and rooms flow without a real homeserver, run the bundled mock:

```bash
node scripts/mock-synapse.mjs    # listens on :8018, token "mock-admin-token"
```

Then point the app at it:

```bash
MATRIX_HOMESERVER=http://localhost:8018
MATRIX_ADMIN_TOKEN=mock-admin-token
```

It implements the Admin API subset used by `packages/matrix` (users, devices, rooms,
create/delete, kick/ban/invite, state, deactivation, password reset, server version) with
in-memory seed data. Development only — never deploy it.

### Automation worker

```bash
# With compose (see docker-compose.yml service zts-automation-worker), or locally:
pnpm --filter @zts/automation-worker start
```

Requires `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, and Matrix env vars.

## Commands

```bash
pnpm lint          # ESLint (flat config) across the workspace
pnpm typecheck     # tsc --noEmit in every package
pnpm test          # Vitest suites (auth, security, matrix, automation, integrations, ai)
pnpm build         # Next.js production build
pnpm db:generate   # regenerate Drizzle migrations after schema changes
make docker-build  # build the production image locally
```

## Conventions

- TypeScript strict; no `any` unless unavoidable and justified.
- Every API route goes through `createApiHandler` / `createPublicApiHandler` - never write a
  bare route handler.
- Every state-changing admin action writes an audit log entry.
- Zod schemas validate all input at the API boundary.
- Internal packages are imported as source (`transpilePackages`); do not add build steps to
  packages.

## Testing notes

- `packages/auth` tests cover hashing, tokens, CSRF, TOTP, recovery codes, secret encryption, WebAuthn helpers.
- `packages/security` tests cover RBAC guards, the role catalog, rate limiting (fake Redis)
  and audit redaction.
- `packages/matrix` tests run the client against an injected mock `fetch` (no network).
- `packages/automation` tests cover catalogs, conditions, safety (loops / max actions).
- `packages/integrations` tests cover adapter registry and secret encrypt/decrypt.
- `packages/ai` tests cover tool schemas, proposals, and heuristic workflow drafts.

### Automation worker

```bash
# With Redis up and .env loaded:
pnpm --filter @zts/automation-worker dev
```

Workers consume the `zts-workflows` BullMQ queue. Manual Execute on `/automation` enqueues a job;
inbound webhooks hit `/api/webhooks/inbound/:slug` after HMAC verification.
