# Deployment

Production runbook for the Zero Trust Security admin platform. The panel is an
isolated management layer around an existing Synapse homeserver — it never shares
the Synapse database or volumes.

## Safety rules (non-negotiable)

1. Inspect the existing stack before any change: `docker ps`, `docker network ls`, current
   reverse-proxy config serving `chat.zero-trust-security.org`.
2. Never modify or remove the `matrix-synapse` / `matrix-postgres` containers, their volumes
   or networks.
3. Never run `docker compose down -v` on production.
4. Take a backup (and snapshot if available) before the first deployment and before every
   schema migration.
5. All changes must be reversible: keep the previous image tag available for rollback.

## Prerequisites

- Docker Engine 24+ with Compose v2
- DNS `A`/`AAAA` for `admin.chat.zero-trust-security.org` (or your `ADMIN_DOMAIN`)
- A Synapse admin access token (`MATRIX_ADMIN_TOKEN`)
- Secrets generated for `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `ZTS_DB_PASSWORD`,
  `REDIS_PASSWORD` (see [Secret hygiene](#secret-hygiene))

## Procedure

```bash
# On the VPS, in /opt/zts-platform:
# 1. Provide .env.production (never committed; chmod 600).
#    Set GHCR_OWNER to the GitHub org/user that owns the packages.
export GHCR_OWNER=rajanchand   # example
export IMAGE_TAG=latest        # or a git SHA tag from CI

# 2. Pull images published by CI (or build locally):
docker compose -f docker-compose.production.yml pull
# Local build alternative:
#   docker build -t ghcr.io/$GHCR_OWNER/zts-admin:$IMAGE_TAG .
#   docker build --target migrator -t ghcr.io/$GHCR_OWNER/zts-admin-migrator:$IMAGE_TAG .
#   docker build -f workers/automation/Dockerfile \
#     -t ghcr.io/$GHCR_OWNER/zts-automation-worker:$IMAGE_TAG .

# 3. Start the isolated data services:
docker compose -f docker-compose.production.yml up -d zts-postgres zts-redis

# 4. Run migrations + RBAC seed (one-off container):
docker compose -f docker-compose.production.yml --profile tools run --rm zts-migrate

# 5. Create the first Super Admin (one-off, interactive):
docker compose -f docker-compose.production.yml --profile tools run --rm \
  zts-migrate pnpm bootstrap-admin

# 6. Start the app + automation worker (admin binds to 127.0.0.1:3000 only):
docker compose -f docker-compose.production.yml up -d zts-admin zts-automation-worker

# 7. Add the admin vhost to the reverse proxy — see checklist below.
```

## Reverse-proxy checklist

Use the example at `docker/caddy/Caddyfile.example` (adapt for nginx/Traefik). Do **not**
replace the Matrix vhost that serves Element / Synapse.

- [ ] New vhost only for `ADMIN_DOMAIN` (e.g. `admin.chat.zero-trust-security.org`)
- [ ] TLS 1.2+ with a valid certificate (Let's Encrypt or existing ACME)
- [ ] HSTS (`max-age` ≥ 1 year) on the admin vhost
- [ ] Proxy to `127.0.0.1:3000` only (no public bind of the Node process)
- [ ] Forward `X-Forwarded-For` / `X-Real-IP` so IP denylist/allowlist and audit logs see clients
- [ ] Do not strip `Origin` / `Host`; CSRF checks depend on them
- [ ] WebSocket upgrade not required for the admin panel today
- [ ] Confirm Matrix (`chat.…`) vhost and Synapse ports are untouched after reload
- [ ] Smoke-test: `curl -fsS https://$ADMIN_DOMAIN/api/health` returns `{ "ok": true, ... }`

## Health SLOs (operational targets)

| Signal | Target | How to observe |
|---|---|---|
| `/api/health` success | ≥ 99.9% over 30 days | Reverse-proxy / uptime monitor |
| Admin p95 latency (authenticated reads) | < 500 ms | App logs / APM |
| Automation worker queue lag | < 60 s under normal load | BullMQ / Redis `zts-workflows` |
| Failed logins → lockout | Works within 1 attempt of threshold | Security Centre events |
| Backup freshness | ≤ 24 h for Postgres; Redis AOF continuous | Backup job timestamps |

Alert if health fails for > 2 minutes or worker restarts > 3 times / hour.

## Secret hygiene

| Secret | Purpose | Rotation |
|---|---|---|
| `SESSION_SECRET` | Session cookies, CSRF HMAC, WebAuthn challenge tokens | Rotate → all sessions invalidated; users re-login. **Does not** re-encrypt TOTP when `MFA_ENCRYPTION_KEY` is set. |
| `MFA_ENCRYPTION_KEY` | AES-256-GCM for TOTP seeds (+ integration secrets that use the MFA helper) | Prefer ≥ 32 chars. Rotating without re-encrypting stored ciphertext forces TOTP re-enrollment. |
| `MATRIX_ADMIN_TOKEN` | Synapse Admin API | Revoke old token in Synapse, set new value, restart `zts-admin` + worker. Documented in SECURITY.md. |
| `REDIS_PASSWORD` / `REDIS_URL` | Redis AUTH | Update compose + `REDIS_URL=redis://:password@zts-redis:6379`. For TLS terminators use `rediss://`. |
| `ZTS_DB_PASSWORD` | App Postgres | Rotate in Postgres + `DATABASE_URL`; rolling restart. |

Generate secrets with `openssl rand -base64 48`. Never commit `.env.production`.

### Redis AUTH / TLS (production)

- Compose enables `--requirepass`; set `REDIS_PASSWORD` and matching
  `REDIS_URL=redis://:${REDIS_PASSWORD}@zts-redis:6379` in `.env.production`.
- For Redis behind stunnel / cloud TLS, use `rediss://` (ioredis enables TLS automatically).
- Do not publish Redis ports on the host; keep the service on `zts-internal` only.

### Admin token rotation runbook

1. Create a new Synapse admin user or issue a fresh access token for the existing admin.
2. Update `MATRIX_ADMIN_TOKEN` in `.env.production`.
3. `docker compose -f docker-compose.production.yml up -d --force-recreate zts-admin zts-automation-worker`
4. Verify: Security Centre / users list still loads; revoke the old token in Synapse.
5. Write an audit note (operator-side) that the token was rotated.

## Monitoring & backups

See [MONITORING.md](./MONITORING.md) and [BACKUP.md](./BACKUP.md). Minimum before go-live:

- Encrypted Postgres dump on a schedule (≥ daily)
- Redis AOF volume included in filesystem / volume snapshots
- Off-site copy with retention ≥ 30 days
- Documented restore drill at least once

## DNS

Create an `A`/`AAAA` record for `admin.chat.zero-trust-security.org` pointing at the VPS
before requesting the TLS certificate.

## Rollback

```bash
export IMAGE_TAG=<previous-sha>
docker compose -f docker-compose.production.yml pull zts-admin zts-automation-worker
docker compose -f docker-compose.production.yml up -d --no-deps zts-admin zts-automation-worker
```

Database migrations are forward-only; restore from backup for schema rollback.

## Automation worker

The worker (`zts-automation-worker`) must run whenever workflows or inbound webhooks are used.
It shares `.env.production` with the admin app (database, Redis, Matrix token, MFA key).
Scale concurrency with `AUTOMATION_CONCURRENCY` (default 5).
