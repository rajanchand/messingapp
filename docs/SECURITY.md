# Security

## Authentication

- **Passwords**: Argon2id (64 MiB memory, t=3), minimum 12 characters with complexity rules.
  Plaintext passwords are never stored or logged.
- **Sessions**: 256-bit opaque tokens delivered in `HttpOnly; Secure; SameSite=Lax` cookies.
  Only the SHA-256 hash is persisted. Absolute lifetime 12 h, idle timeout 60 min. Sessions
  are revocable individually or in bulk ("sign out everywhere").
- **Account lockout**: 5 consecutive failures lock the account for 15 minutes and emit an
  `ACCOUNT_LOCKED` security event. Unknown usernames burn an equivalent Argon2 verification
  to prevent timing-based user enumeration.
- **MFA (TOTP)**: opt-in per account. Seeds are encrypted at rest with AES-256-GCM using a
  key derived (HKDF-SHA256) from `SESSION_SECRET`. Ten single-use recovery codes are issued
  once and stored only as hashes. **Rotating `SESSION_SECRET` invalidates stored TOTP seeds**;
  users must re-enroll (documented operational trade-off).
- **Sudo mode**: dangerous operations (deactivation, password resets, MFA setup) require
  re-authentication; the resulting sudo window lasts 10 minutes and is enforced
  **server-side** on each protected endpoint.
- **WebAuthn/passkeys**: enrollable alongside TOTP. Only credential IDs and public keys are
  stored (`webauthn_credentials`). Challenges live in Redis with a short TTL.
- **IP blocks**: admin-panel CIDR denylist (`ip_blocks`) managed from Security Centre.
- **Automation**: workflows are idempotent, capped (max actions / timeout / cascade depth),
  and executed by BullMQ workers. Integration secrets use AES-256-GCM (`encryptSecret`).
- **AI assistant**: read-only tools only; privileged actions go through `ai_proposals`
  with human approve + sudo.

## CSRF

Mutations require the `X-CSRF-Token` header. The token is an HMAC (keyed by
`SESSION_SECRET`) over the session token hash - a stateless double-submit variant - and is
only obtainable via an authenticated `GET /api/auth/me`. The `Origin` header, when present,
must match the request host.

## RBAC

Eight system roles (Super Admin, Security Admin, User Admin, Room Admin, Moderator,
Automation Admin, Auditor, Normal User) mapped to granular permissions (`users.read`,
`security.manage`, ...). Permissions are resolved from the database per request and enforced
with `requirePermission()` in every route. UI hiding is cosmetic; the server is the boundary.

## Rate limiting

Fixed-window counters in Redis, keyed per policy + client IP: login/MFA/sudo 10 per 5 min,
mutations 60/min, reads 300/min. Auth-critical limiters **fail closed** if Redis is down.

## Secrets

- No secrets in git, Docker images, frontend bundles or logs. `.env` files are gitignored;
  `.env.example` documents every variable.
- The Synapse admin token (`MATRIX_ADMIN_TOKEN`) is used exclusively server-side.
- The structured logger (pino) redacts password/token/secret/cookie paths; the audit writer
  independently redacts credential-like keys before persisting metadata.

## Audit logging

Every sensitive action writes an append-only entry: actor, action, target, IP, user agent,
result, redacted metadata, timestamp. The application exposes no update/delete paths for
audit rows. Never logged: passwords, tokens, secrets, encryption keys, message contents.

## Matrix / E2EE boundaries

- The panel manages accounts, devices and rooms via the Synapse Admin API only.
- It cannot and will not decrypt E2EE content; no such capability exists server-side, and
  none will be added. Cross-signing, key backup and verification remain fully client-side
  (Element X).

## Network expectations (production)

- Only 80/443 are exposed publicly; the admin app binds to `127.0.0.1:3000` behind the
  reverse proxy. PostgreSQL and Redis live on an internal Docker network with no host ports.
- TLS 1.2+, HSTS, and baseline security headers configured in `apps/admin/next.config.ts`.
  Pages get a per-request nonce-based CSP (`script-src 'nonce-…' 'strict-dynamic'`) from
  `apps/admin/src/proxy.ts`; API routes get a fully locked-down static CSP.

## Reporting

Contact the platform operator at the address configured in `SUPPORT_EMAIL`.
