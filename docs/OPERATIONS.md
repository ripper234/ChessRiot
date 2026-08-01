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
| `ACCOUNT_ID_SECRET` | Secret | HMAC key for optional verified identities |
| `OBSERVABILITY_HASH_SECRET` | Secret | HMAC key for privacy-safe event correlation |
| `OPS_READ_SECRET` | Secret | Short-lived Control grants |

Optional capabilities fail closed when incomplete:

| Capability | Values |
|---|---|
| Closed-app turn alerts | `VAPID_PUBLIC_KEY`, secret `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT` |
| Demo narration regeneration | secret `OPENAI_API_KEY`, secret `VIDEO_REGEN_SHARED_SECRET`, and `BUCKET` |

Never restore the retired `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, or
`SESSION_SIGNING_SECRET` values unless the product deliberately reintroduces
that architecture.

## Release gate

`npm run build` runs lint, TypeScript, 214+ unit/component tests, the production
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
2. Verify the homepage, `/app`, one Solo game, Settings, history expansion,
   `/privacy`, and `/changelog` in a browser.
3. Verify Control reports the same Development version and fresh health data.
4. Do not promote Production until the owner reviews Development and clicks the
   explicit Control action.
5. After promotion, repeat health and the small Production smoke test.

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
