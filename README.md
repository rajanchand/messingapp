# Zero Trust Security Platform

A production-grade, self-hosted administration and collaboration platform built around an
existing **Matrix Synapse** homeserver, fully compatible with **Element X**.

> The platform is a management and automation layer **around** Synapse. It never replaces
> Synapse, never touches the Synapse database directly, and never weakens Matrix E2EE.

## What's included

- **Admin panel** (`apps/admin`): Next.js, TypeScript strict, Tailwind, shadcn-style UI.
- **Secure authentication**: Argon2id, sessions, CSRF, lockout, rate limits, mandatory MFA for
  privileged roles, TOTP + WebAuthn (login / MFA / sudo), dedicated `MFA_ENCRYPTION_KEY`.
- **RBAC**: 8 system roles including reports/media/federation permissions.
- **Users / rooms / moderation**: deactivate + GDPR erase, shadow-ban, server notices,
  event reports, media quarantine, make-room-admin, federation destinations.
- **Security Centre**: IP denylist + allowlist (enforced), sessions, suspicious IPs.
- **Audit export**: CSV/JSON download; Object Lock notes in docs.
- **Automation worker**: BullMQ worker in prod compose; ban/unban/shadow-ban actions.
- **Ops**: GHCR push + Trivy/npm audit in CI, monitoring/backup/DR docs.

## Repository layout

```text
apps/admin/          Next.js admin panel (UI + API route handlers)
packages/database/   Drizzle ORM schema, migrations, RBAC catalog
packages/auth/       Passwords, sessions, MFA, CSRF, WebAuthn
packages/security/   RBAC engine, rate limiting, audit writer, IP helpers
packages/matrix/     Typed Synapse Admin API client
packages/automation/ Workflow catalogs + enqueue helpers
workers/automation/  BullMQ automation worker
docker/              Reverse proxy example config
scripts/             bootstrap-admin, mock-synapse
docs/                Architecture, security, deployment, monitoring, backups
```

## Quick start (development)

Requirements: Node 22+, pnpm 9, Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dedicated app database and Redis (ports 5433/6380)
make up

# 3. Configure environment
cp .env.example .env
# Fill in: MATRIX_ADMIN_TOKEN, SESSION_SECRET (openssl rand -base64 48),
# optional MFA_ENCRYPTION_KEY, etc.

# 4. Apply migrations and seed RBAC roles
set -a && source .env && set +a
make migrate && make seed

# 5. Create your Super Admin account
make bootstrap-admin

# 6. Run the app (+ optional mock Synapse)
make dev
# -> http://localhost:3000
```

## Production (summary)

```bash
export GHCR_OWNER=<github-user-or-org>
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml --profile tools run --rm zts-migrate
docker compose -f docker-compose.production.yml up -d zts-admin zts-automation-worker
```

Full instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Also see
[MONITORING.md](docs/MONITORING.md), [BACKUP.md](docs/BACKUP.md), [SECURITY.md](docs/SECURITY.md),
[MAS-OIDC.md](docs/MAS-OIDC.md). **Never** run `docker compose down -v` against production.

## Verification

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - system design and phase roadmap
- [docs/SECURITY.md](docs/SECURITY.md) - threat model and security controls
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - local development guide
- [docs/ELEMENT-X.md](docs/ELEMENT-X.md) - Element X configuration vs fork/build customization
