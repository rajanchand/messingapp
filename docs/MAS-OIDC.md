# MAS / OIDC readiness (admin panel)

Matrix Authentication Service (MAS) and OIDC are the preferred identity path for
**Element X clients**. Admin-panel SSO for this platform ships as a **design stub**
with env placeholders and a login UI affordance; full IdP authorization-code login
is not enabled until an operator completes the checklist below.

## Current state

| Surface | Status |
|---|---|
| Element X ↔ Synapse / MAS | Documented in `ELEMENT-X.md` — operate independently of this panel |
| Admin panel password + MFA + WebAuthn | Implemented |
| Admin panel OIDC status API | `GET /api/auth/oidc` (public) |
| Admin panel OIDC begin | `POST /api/auth/oidc` → `501 not_implemented` until wired |
| Login UI SSO button | Shows label from status API (“coming soon” / configured-but-disabled) |

## Env placeholders

```bash
# Admin panel OIDC (separate client from Element / MAS)
ADMIN_OIDC_ENABLED=false
ADMIN_OIDC_ISSUER=https://idp.example.org
ADMIN_OIDC_CLIENT_ID=
ADMIN_OIDC_CLIENT_SECRET=
# ADMIN_OIDC_REDIRECT_URI=https://admin.example.org/api/auth/oidc/callback
```

## Design stub (when enabling)

1. Register an OIDC client for `ADMIN_DOMAIN` (separate from Element).
2. Map IdP groups → platform roles (`super_admin`, `security_admin`, …) via `app_settings`
   or a future `oidc_role_maps` table.
3. Still require MFA for privileged roles after SSO (or rely on IdP MFA + WebAuthn step-up).
4. Keep local password bootstrap account for break-glass (documented in DEPLOYMENT.md).
5. Never put `MATRIX_ADMIN_TOKEN` behind user OIDC — Synapse admin token stays server-side.
6. Implement authorization-code + PKCE, store only hashed session tokens, audit `OIDC_LOGIN`.

## Operator checklist before enabling chat OIDC

- [ ] MAS (or Synapse OIDC) configured for the homeserver
- [ ] Element X well-known / login flows verified
- [ ] Admin panel still reachable with local MFA if chat IdP is down
- [ ] Audit logging covers admin logins regardless of IdP
- [ ] `ADMIN_OIDC_*` filled and `ADMIN_OIDC_ENABLED=true` only after callback route ships
