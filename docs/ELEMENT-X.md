# Element X Integration

The platform is a server-side management layer; Element X (and Element Web) connect directly
to the existing homeserver and are unaffected by the admin panel. Nothing in this repository
changes the Matrix client-server API, E2EE, cross-signing, verification or key backup.

## Connecting Element X

1. Install Element X (iOS/Android).
2. Choose "Sign in" and enter the homeserver: `chat.zero-trust-security.org`.
3. Log in with a Matrix account (accounts created via the admin panel work immediately).
4. Complete device verification against an existing session, and set up key backup when
   prompted - both are client-side Matrix features and remain fully functional.

### Server requirements (already satisfied by a standard Synapse deployment)

- `https://chat.zero-trust-security.org/.well-known/matrix/client` should advertise the
  homeserver base URL for discovery.
- Element X requires **sliding sync** (natively supported by Synapse ≥ 1.114 via
  `msc3575`/native sliding sync) and works best with **Matrix Authentication Service (MAS)**
  for OIDC-based login on newer versions. Verify your Synapse version before rollout;
  password login continues to work with classic Synapse auth on current builds.
- Push notifications flow through the standard Matrix push gateway (Sygnal or
  `matrix.org`'s gateway used by official Element builds); no admin-panel involvement.

## What is configuration vs fork vs build

Be precise about what a *branded* Element X deployment requires:

### Configuration only (no fork)

- Default homeserver at first launch: **not configurable** in the official store apps - users
  simply type the homeserver. (Element Web *does* support this via `config.json`:
  `default_server_config`.)
- Well-known discovery: configure `.well-known/matrix/client` on your domain so users can
  enter just the domain name.

### Element Web (self-hosted) - configuration file

Self-hosting Element Web allows extensive rebranding via `config.json` /
`brand`, `default_server_config`, custom themes, and URL policy links. This is the fastest
path to a fully branded *web* client without forking.

### Source-code fork / build-time customization (Element X mobile)

Custom logo, app name, welcome message, color scheme, default homeserver, and registration
behaviour in **Element X iOS/Android require forking the official repositories and building
your own app** (element-x-ios / element-x-android). That entails:

- Your own Apple Developer / Google Play accounts and signing keys.
- Maintaining a fork that tracks upstream releases.
- Your own push infrastructure (Sygnal with your APNs/FCM credentials) because push
  certificates are bound to the app identifier.

There is no supported way to achieve these customizations through server-side configuration
alone - any claim otherwise would be false. Recommendation: use stock Element X with your
homeserver for mobile, plus a branded self-hosted Element Web, unless the organisation is
prepared to own a mobile fork.

## E2EE guarantees

- The admin panel never terminates or intercepts E2EE.
- Device management via the Admin API (listing/removing devices) operates on device records,
  not message keys.
- Removing a user's device logs that device out; it cannot read that device's history.
