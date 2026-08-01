# Monitoring

Operational signals for the Zero Trust Security admin platform in production.

## What to monitor

| Component | Signal | Suggested check |
|---|---|---|
| Admin app | HTTP health | `GET https://$ADMIN_DOMAIN/api/health` every 60s |
| Admin app | Container health | Docker healthcheck already probes `/api/health` |
| Automation worker | Process up | `docker inspect -f '{{.State.Status}}' zts-automation-worker` |
| Postgres | Accepting connections | Compose healthcheck (`pg_isready`) |
| Redis | AUTH + PING | Compose healthcheck with password |
| Host | Disk for volumes | Alert when `/var/lib/docker` > 80% |
| TLS | Certificate expiry | ACME / external cert monitor for admin + Matrix domains |

## Application metrics (lightweight)

Without a dedicated Prometheus exporter yet, rely on:

1. **Structured logs** (pino) from `zts-admin` and the worker — ship to journald/Loki/CloudWatch.
2. **Security Centre** — failed logins, lockouts, IP blocks (human triage).
3. **Audit log** — privileged actions; export periodically (CSV/JSON) for SIEM.

Key log fields to index: `level`, `msg`, `requestId` (if present), `action` on audit writes.

## Suggested alert thresholds

| Condition | Severity | Action |
|---|---|---|
| Health endpoint fails 3 consecutive checks | Critical | Page on-call; check container + proxy |
| Worker not running | High | Restart worker; inspect BullMQ backlog |
| Postgres unhealthy > 2 min | Critical | Check disk / volume; restore if corrupt |
| Spike in `ACCOUNT_LOCKED` / login failures | Medium | Review Security Centre; confirm not attack |
| Image pull / OOMKill on admin | High | Check memory limits; roll back tag |

## Health SLO reminders

Documented in [DEPLOYMENT.md](./DEPLOYMENT.md): 99.9% health availability, p95 authenticated
reads < 500 ms, automation lag < 60 s, backup age ≤ 24 h.

## Optional integrations

- Uptime Kuma / Better Stack / Pingdom against `/api/health`
- Host agent (node_exporter, Datadog) for CPU/RAM/disk on the VPS
- Redis `INFO` / BullMQ UI only on localhost or VPN — never public
