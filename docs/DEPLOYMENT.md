# Deployment (skeleton - finalized in Phase 6)

> Phase 1 deliberately does **not** deploy anything to the VPS. This document captures the
> intended procedure and the safety rules; Phase 6 completes CI/CD, monitoring and backups.

## Safety rules (non-negotiable)

1. Inspect the existing stack before any change: `docker ps`, `docker network ls`, current
   reverse-proxy config serving `chat.zero-trust-security.org`.
2. Never modify or remove the `matrix-synapse` / `matrix-postgres` containers, their volumes
   or networks.
3. Never run `docker compose down -v` on production.
4. Take a backup (and snapshot if available) before the first deployment.
5. All changes must be reversible: keep the previous image tag available for rollback.

## Intended procedure

```bash
# On the VPS, in /opt/zts-platform:
# 1. Provide .env.production (never committed; chmod 600).
# 2. Pull images published by CI (Phase 6) or build locally:
docker build -t zts-admin:v0.1.0 .
docker build --target migrator -t zts-admin-migrator:v0.1.0 .

# 3. Start the isolated data services:
docker compose -f docker-compose.production.yml up -d zts-postgres zts-redis

# 4. Run migrations + RBAC seed (one-off container):
docker compose -f docker-compose.production.yml --profile tools run --rm zts-migrate

# 5. Create the first Super Admin (one-off, interactive):
docker compose -f docker-compose.production.yml --profile tools run --rm \
  zts-migrate pnpm bootstrap-admin

# 6. Start the app (binds to 127.0.0.1:3000 only):
docker compose -f docker-compose.production.yml up -d zts-admin

# 7. Add the admin vhost to the reverse proxy.
#    See docker/caddy/Caddyfile.example - adapt to the proxy already in use
#    (nginx/traefik/caddy) WITHOUT touching the existing Matrix vhost.
```

## DNS

Create an `A`/`AAAA` record for `admin.chat.zero-trust-security.org` pointing at the VPS
before requesting the TLS certificate.

## Rollback

```bash
docker compose -f docker-compose.production.yml up -d --no-deps zts-admin  # previous tag
```

Database migrations are forward-only; restore from backup for schema rollback.
