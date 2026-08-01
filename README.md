# Zero Trust Security Platform

A production-grade, self-hosted administration and collaboration platform built around an
existing **Matrix Synapse** homeserver, fully compatible with **Element X**. This repository
contains the custom-branded admin panel and its supporting packages (Phase 1).

> The platform is a management and automation layer **around** Synapse. It never replaces
> Synapse, never touches the Synapse database directly, and never weakens Matrix E2EE.

## What's included (Phase 1)

- **Admin panel** (`apps/admin`): Next.js 16, TypeScript strict, Tailwind CSS 4, shadcn-style UI.
- **Secure authentication**: Argon2id, server-side sessions in HttpOnly cookies, CSRF
  protection, account lockout, rate limiting, TOTP MFA with recovery codes, sudo mode for
  dangerous actions.
- **RBAC** (`packages/security`): 8 system roles, granular permissions, enforced server-side.
- **Synapse integration** (`packages/matrix`): typed client for the Synapse Admin API.
- **User management**: search, create, deactivate/reactivate, password reset, devices, rooms,
  role assignment - all audited.
- **Dashboard**: live Matrix/homeserver statistics, component health, activity charts.
- **Audit logging**: append-only, searchable, secret-redacting.
- **Docker**: dev compose (dedicated `zts-postgres` + `zts-redis`), production image + compose
  skeleton, CI workflow.

Later phases add rooms/moderation, the security centre, the automation engine and workflow
builder, integrations (Slack, GitHub, ...), the AI assistant, and full CI/CD + backups. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```text
apps/admin/          Next.js admin panel (UI + API route handlers)
packages/database/   Drizzle ORM schema, migrations, RBAC catalog
packages/auth/       Passwords, sessions, MFA, CSRF primitives
packages/security/   RBAC engine, rate limiting, audit writer
packages/matrix/     Typed Synapse Admin API client
docker/              Reverse proxy example config
scripts/             bootstrap-admin (first Super Admin)
docs/                Architecture, security, development, Element X docs
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
# Fill in: MATRIX_ADMIN_TOKEN, SESSION_SECRET (openssl rand -base64 48), etc.

# 4. Apply migrations and seed RBAC roles
set -a && source .env && set +a
make migrate && make seed

# 5. Create your Super Admin account
make bootstrap-admin

# 6. Run the app
make dev
# -> http://localhost:3000
```

## Production (summary)

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml --profile tools run --rm zts-migrate
docker compose -f docker-compose.production.yml up -d
```

Full instructions, reverse-proxy configuration and safety rules:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (finalized in Phase 6). **Never** run
`docker compose down -v` against the production stack.

## Verification

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - system design and phase roadmap
- [docs/SECURITY.md](docs/SECURITY.md) - threat model and security controls
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - local development guide
- [docs/ELEMENT-X.md](docs/ELEMENT-X.md) - Element X configuration vs fork/build customization
