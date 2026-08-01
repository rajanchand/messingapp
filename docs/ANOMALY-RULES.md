# Anomaly detection (Security Centre)

Lightweight rules that close the loop between login failures, IP blocks, and automation.

## Built-in signals

| Signal | Source | Default behaviour |
|---|---|---|
| Suspicious IPs | ≥ 3 failed logins / 7 days in Security overview | Displayed in Security Centre |
| Account lockout | 5 failures → 15 min lock | `ACCOUNT_LOCKED` security event |
| Login burst | `evaluateLoginBurst` on failed admin login | Emits `LOGIN_BURST_FAILURES`, security event, optional notify + auto IP block |
| New device | `evaluateNewDevices` helper | Emits `NEW_DEVICE_SEEN` + notify when callers supply before/after device lists |

## Security Centre → Anomaly engine

Tab **Anomaly engine** (`GET/PATCH /api/security/anomaly`) stores settings in `app_settings`:

- `enabled`, `burstFailureThreshold`, `burstWindowMinutes`
- `autoBlockEnabled` (default **false** — prefer human confirmation)
- `autoBlockTtlMinutes`, `notifyAdmins`

Auto-block skips IPs on the **IP allowlist**. Blocks appear under Security → IP blocks and are
enforced by `createApiHandler`.

## Recommended workflows

1. **Burst fails → notify**  
   Trigger `LOGIN_BURST_FAILURES` → action `NOTIFY_ADMIN`.

2. **Burst fails → auto-block**  
   Enable `autoBlockEnabled` in Anomaly settings, **or** Automation action `BLOCK_IP`
   (`cidr` / `payload.ip`, optional `ttlMinutes`). Prefer high thresholds and office/VPN allowlists.

3. **Shadow-ban abusive Matrix users**  
   Trigger on report volume (future) → `SHADOW_BAN_USER` action (privileged).

## API / UI

- Security Centre shows `suspiciousIps` from `/api/security/overview`.
- Anomaly settings: `/api/security/anomaly`.
- IP denylist + allowlist enforced in `createApiHandler`.
- Automation actions: `BAN_USER`, `UNBAN_USER`, `SHADOW_BAN_USER`, `BLOCK_IP`.
