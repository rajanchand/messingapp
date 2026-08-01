# Backups & disaster recovery

The admin platform uses a **dedicated** Postgres database and Redis. Synapse data is
out of scope here — continue backing up Matrix with your existing Synapse procedures.

## What to back up

| Asset | Method | Frequency | Notes |
|---|---|---|---|
| `zts_postgres_data` | `pg_dump` (custom or SQL) → encrypt | Daily (minimum) | Prefer dump over raw volume copy while DB is live |
| `zts_redis_data` | Volume / filesystem snapshot (AOF on) | With host snapshots | Acceptable to lose recent rate-limit counters |
| `.env.production` | Encrypted secret store (age/SOPS/Vault) | On every change | Required to decrypt MFA seeds + reconnect |
| GHCR image digests | Record deployed SHA tags | On each deploy | Enables rollback without rebuild |

Do **not** back up Synapse volumes through this compose file.

## Encrypted Postgres dump (example)

```bash
# On the VPS — requires gpg or age. Example with age:
BACKUP_DIR=/var/backups/zts
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f docker-compose.production.yml exec -T zts-postgres \
  pg_dump -U "$ZTS_DB_USER" -d "$ZTS_DB_NAME" -Fc \
  | age -r "$AGE_RECIPIENT" > "$BACKUP_DIR/zts-$STAMP.dump.age"
chmod 600 "$BACKUP_DIR/zts-$STAMP.dump.age"
```

Retain ≥ 30 days locally and copy off-site (S3, B2, rsync to another host).

### Immutable / Object Lock exports (audit)

For regulatory retention of audit CSV/JSON exports:

1. Export via `GET /api/audit/export?format=json` (or CSV) with an admin session.
2. Upload to an S3-compatible bucket with **Object Lock** (compliance or governance mode)
   and a retention period matching policy (e.g. 1–7 years).
3. Store the object key + SHA-256 checksum in your change ticket.
4. Application audit rows remain append-only in Postgres; Object Lock is for **exported**
   copies that must survive app DB restore/wipe.

## Restore checklist (Postgres)

1. Stop `zts-admin` and `zts-automation-worker` (keep Redis if only restoring DB).
2. Decrypt dump → `pg_restore` into a fresh database or replace after dropping connections.
3. Verify migration version matches the image you will start (`drizzle` journal).
4. Start admin + worker; confirm `/api/health` and login.
5. If `MFA_ENCRYPTION_KEY` / `SESSION_SECRET` differ from backup-time values, TOTP and
   sessions will not decrypt/validate — restore secrets from the encrypted secret store too.

## DR drill

At least once per release cycle:

- [ ] Restore a recent dump into a non-prod compose stack
- [ ] Bootstrap is **not** required if admin users are in the dump
- [ ] Confirm MFA login still works with restored `MFA_ENCRYPTION_KEY`
- [ ] Confirm Synapse connectivity with restored `MATRIX_ADMIN_TOKEN`
- [ ] Time the restore; update RTO/RPO notes below

## RTO / RPO targets (initial)

| Metric | Target |
|---|---|
| RPO (admin DB) | ≤ 24 h (daily dump); improve with continuous WAL archiving if needed |
| RTO (admin panel) | ≤ 2 h (restore DB + pull previous image + proxy intact) |
| Synapse outage | Independent — Element chat may work while admin panel is down and vice versa |
