# ChessRiot operations

## Environment matrix

| Role | Canonical hostname | Data | Source behavior |
|---|---|---|---|
| Development | `dev.chessriot.gg` | Isolated D1 and R2 | Receives each reviewed release |
| Production | `chessriot.gg` | Isolated D1 and R2 | Manual owner promotion only |
| Control | `control.chessriot.gg` | Owner-only Control state | Observes and promotes, never serves games |

Staging is retired. The legacy `*.ripper234.chatgpt.site` addresses may remain
provider aliases but are not canonical application origins.

## Runtime configuration

Every game Site must bind D1 as `DB` and R2 as `BUCKET` in
`.openai/hosting.json`. Required hosted values are:

| Name | Kind | Purpose |
|---|---|---|
| `CHESSRIOT_ENV` | Public | `development` or `production` |
| `APP_ORIGIN` | Public | Exact canonical origin for invitations and links |
| `CONTROL_ORIGIN` | Public | Exact Control origin allowed to read operations |
| `ACCOUNT_ID_SECRET` | Secret | HMAC key for required Google account identities |
| `OBSERVABILITY_HASH_SECRET` | Secret | HMAC key for privacy-safe event correlation |
| `OPS_READ_SECRET` | Secret | Short-lived Control grants |
| `GOOGLE_CLIENT_ID_DEV` | Public on Development | Development Google OAuth client |
| `GOOGLE_CLIENT_SECRET_DEV` | Secret on Development | Development Google OAuth client secret |
| `GOOGLE_AUTH_SESSION_SECRET_DEV` | Secret on Development | Development OAuth transaction and session signing |
| `GOOGLE_CLIENT_ID_PROD` | Public on Production | Production Google OAuth client |
| `GOOGLE_CLIENT_SECRET_PROD` | Secret on Production | Production Google OAuth client secret |
| `GOOGLE_AUTH_SESSION_SECRET_PROD` | Secret on Production | Production OAuth transaction and session signing |

Each game Site supplies only the Google values with its own suffix. A target
must never receive the other environment's client or session credentials.

`ACCOUNT_ID_SECRET` is a permanent identity key, not a routine rotation key.
Changing or losing it changes every derived Google account ID and strands that
environment's usernames, friends, feature flags, memberships, and history.
Back it up in the secret manager. Do not rotate it without first shipping and
testing an explicit identity-mapping migration.

Optional capabilities fail closed when incomplete:

| Capability | Values |
|---|---|
| Closed-app turn alerts | `VAPID_PUBLIC_KEY`, secret `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT` |
| Development OpenAI calls | secret `OPENAI_API_KEY_DEV` |
| Production OpenAI calls | secret `OPENAI_API_KEY_PROD` |
| Demo narration regeneration | the target's environment-specific OpenAI key, secret `VIDEO_REGEN_SHARED_SECRET`, and `BUCKET` |

The Sites runtime has not produced a recurring Worker event for ChessRiot, even
when a valid Cron Trigger survives the build. Do not treat a built trigger as a
delivery guarantee. The coordinator starts another retry only when its
25-second target leaves reserve for that round. Each lane claims at most one
target per batch, independent lanes cannot cancel each other, and healthy due
backlog continues only while there is room for another bounded provider call.
Slow backlog therefore remains unleased for a later wake instead of relying on
work beyond the platform's post-response limit. Later durable attempts still
need subsequent non-health API traffic. The dormant `scheduled` handler remains
artifact-validated for migration to a compatible host, but current Production
decisions must use the Sites behavior above.

Never restore the retired `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, or
`SESSION_SIGNING_SECRET` values unless the product deliberately reintroduces
that architecture.

Google configuration is required for play and fails closed when incomplete.
Client IDs are target-local public values. Client secrets and session secrets
are target-local secrets and must never move between Sites projects.
The exact callbacks are:

| Environment | Authorized redirect URI |
|---|---|
| Development | `https://dev.chessriot.gg/api/auth/google/callback` |
| Production | `https://chessriot.gg/api/auth/google/callback` |

Keep Development in custom allowlist mode. An admitted tester opens Dev through
the Sites gate before starting Google login; Google's redirect then returns in
that same browser session. While Google's OAuth Audience is in Testing, add the
same tester separately to Google's test-user list; the Sites and Google lists
are independent gates. Do not make Dev public for OAuth. Use Production's public
homepage, `/privacy`, and `/terms` in Google Branding and consent setup.

## Release gate

`npm run build` runs lint, TypeScript, the unit/component suite, the production
artifact build, binding/migration validation, rendered-output checks, and the
Miniflare end-to-end suite. GitHub CI repeats the gate, audits production
dependencies, and uploads a 14-day CycloneDX SBOM.

Every artifact includes `.openai/release-fingerprint.json`. Development and
Production must match on `version`, `sourceSha256`, `lockSha256`,
`migrationsSha256`, `portableManifestSha256`, and binding names. Their
`targetProjectId` and `targetManifestSha256` are expected to differ.

After deployment:

1. Confirm `/api/health` returns HTTP 200, the expected version/environment,
   `database: "ok"`, and all core configuration booleans `true`.
2. Verify the signed-out homepage and that `/app` requires Google login. Confirm
   Privacy and Terms appear in the registration flow but not homepage
   navigation.
3. Begin login only on the canonical hostname. For a fresh test account, claim
   a valid permanent username, then verify the signed-in dashboard, friend
   request lifecycle, direct challenge accept/decline flow, one Solo game, automatic history,
   Settings, one-screen game layout, clocks, and `/changelog`.
4. Sign out and confirm `/app`, `/history`, and a private seat link require
   login rather than falling back to guest play.
5. Verify Control reports the same Development version and fresh health data.
   Submit a Magic Rules invite request from an ordinary test account, verify the
   Control key icon shows the exact pending count, and approve that request in
   the Development queue. Confirm it disappears and the account gains access.
   The separate manual feature-flag control remains available for revocation.
6. Confirm Worker logs contain no request-time push drain errors. On one
   supported Android device, run **TEST THIS DEVICE**, then verify an opponent
   move while the PWA is backgrounded or closed. Provider acceptance alone is
   not proof of an operating-system banner. Do not expect a recurring Sites
   Worker event until the hosting capability is explicitly added and verified.
7. Do not promote Production until the owner reviews Development and clicks the
   explicit Control action.
8. After promotion, confirm Development and Production report the same version
   and source fingerprint, then repeat legal-page, OAuth, account-gate, and the
   small Production OpenAI smoke test. Do not copy users, friends, games, or
   feature flags between their isolated databases.

The owner-only `POST /api/ops/llm-smoke` route accepts only a short-lived
`llm:smoke` Control grant and sends the fixed `CHESSRIOT_OK` marker to
`gpt-5.6-luna`. Before the provider call, D1 permanently reserves one attempt
for that application version and environment, so concurrent or replayed grants
cannot create repeat spend. A failed or ambiguous attempt consumes that
release's slot; deploy a new version before testing a rotated key.

The ordinary suite contains one live LLM test and skips it unless both
`RUN_OPENAI_LIVE_TEST=1` and an exact target are supplied. It is an explicit
operator test, not the hosted D1 spend boundary. Do not run it in addition to
the Control smoke for the same requested check. When intentionally using the
suite test, invoke it in separate processes; it never falls through from one
suffixed key to another:

```bash
RUN_OPENAI_LIVE_TEST=1 OPENAI_LIVE_TARGET=development \
  OPENAI_API_KEY_DEV='<from the Development secret manager>' \
  npx vitest run lib/openai-live.test.ts
RUN_OPENAI_LIVE_TEST=1 OPENAI_LIVE_TARGET=production \
  OPENAI_API_KEY_PROD='<from the Production secret manager>' \
  npx vitest run lib/openai-live.test.ts
```

## Domain and TLS checks

Sites owns certificate issuance after DNS validation. Do not buy or upload a
Namecheap certificate. For each hostname, verify the exact A/CNAME and two TXT
values shown by Sites, then confirm the Site reports the domain active and TLS
issued. Preserve unrelated MX/TXT records and remove only conflicting records
for the same host.

The initial release sends a one-day HSTS policy without `includeSubDomains`.
After Dev and Control both report active TLS, increase the duration deliberately;
add `includeSubDomains` only when every intended subdomain is HTTPS-only.

## Incident response

- Stop promotion when health is degraded, CI fails, or the artifact does not
  match the immutable release tree.
- Prefer the Control advanced rollback to a known immutable release. Never edit
  Production source directly.
- Rotate any exposed environment secret in that Site, invalidate affected
  grants or endpoints, and verify privacy-safe logs before restoring service.
- Keep the latest Production release unchanged while a Development fix is under
  review.
