# ChessRiot operations

## Environment matrix

| Role | Canonical hostname | Data | Source behavior |
|---|---|---|---|
| Development | `dev.chessriot.gg` | Isolated D1 and R2 | Receives each reviewed release |
| Production | `chessriot.gg` | Isolated D1 and R2 | Live alpha; standing authorization after Dev validation and green CI |
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
Unattempted devices have priority over retries. Each lane reports its earliest
database retry/lease time, so a failed target cannot delay healthy due work or
lose its wake when another device succeeds. A future-only row is retried inside
the remaining budget even if the current drain attempted no sends.
Slow backlog therefore remains unleased for a later wake instead of relying on
work beyond the platform's post-response limit. Later durable attempts still
need subsequent non-health API traffic. The dormant `scheduled` handler remains
artifact-validated for migration to a compatible host, but current Production
decisions must use the Sites behavior above.

For a missing Android alert, first inspect the recipient's active device
registration. Browser permission alone is insufficient, and no server fix can
create an Android subscription without the browser's opt-in. The mobile recovery
notice offers Enable and Not now; explicit dismiss/disable choices are preserved.
The server's current-account opt-in survives loss of only the local preference.
Run TEST THIS DEVICE on each intended receiving device, then alternate at least
four turns with the receiving app closed and check exact-game navigation.
Record provider acceptance separately from actual Android presentation.

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

`npm run build` runs the production dependency security audit, lint, TypeScript, the unit/component suite, the production
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
7. Promote the validated Development release after GitHub CI passes on its exact
   commit. Ron has given standing alpha-release authorization; do not ask for
   approval again unless he pauses or restricts deployment. Control remains an
   optional manual promotion path.
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


## Notification-to-board performance

At 2026-09-25 21:38 UTC (00:38 Israel time), Production v0.31.3 D1
observability recorded one initial `game.loaded` HTTP 200 at 4,455 ms and a
concurrent `/api/auth/session` at 3,992 ms. The corresponding Worker wall times
were 5,151 ms and 4,626 ms; they include `waitUntil` work and are not response
latencies. Seven subsequent unchanged game reads had Worker wall times of
1,540–1,682 ms, but unchanged polling creates no observability event, so their
response latencies are unknown. None of these measures is an Android
notification-tap-to-board time. There is no comparable initial-game sample yet
for v0.31.4, so do not infer an improvement or regression from this baseline.
Use the fixed numeric `Server-Timing` stages and existing D1 request latency
after this instrumentation ships, then measure the Android tap-to-board flow.

Hosted migrations are the schema source of truth. `ensureSchema` checks the D1
and R2 continuity marker once per Worker isolate but does not replay schema
creation, legacy repairs or credit backfills on hosted reads. Local disposable
test databases retain the legacy bootstrap path. Build-hashed static assets
are cached until their URL changes; unversioned icons and the manifest still
revalidate. Authenticated game responses and HTML are never stored in the
service worker cache.

After a turn notification is tapped, the Worker records a local timing receipt
with its timestamp, game version and observed window category. It is eligible
for two minutes, at most 40 receipts are retained, and a successful board
measurement consumes its receipt. It contains no position, name or account
data and does not block navigation. The game shows the
last **Notification to first painted board** sample in milliseconds. A pair of
animation frames makes this a conservative browser-paint estimate, accurate
to roughly a frame rather than a hardware display scanout measurement.
**Already on this board**, **Existing app window**, and **New app window**
describe the Worker clients at click time; an existing window can still need
a full page navigation if warm routing fails. A deferred
`notification.board_painted` event stores only elapsed milliseconds and the
window category for aggregate analysis. The four-turn notification test keeps
its chessboard collapsed and therefore does not claim a board-paint sample.

## One Android, four-turn acceptance test

1. On the Android being tested, open `https://chessriot.gg/notification-test` and
   sign in. Select **Start test** and allow notifications.
2. Select **Send notification 1**, then immediately go Home or lock the phone. The server
   makes Riot Bot's real response about eight seconds later; no second device
   or second account is required.
3. Tap the Android notification. It must open this exact game. Confirm that
   this is the notification you saw. Repeat until four rounds are verified.
4. On round three, also try dismissing ChessRiot from recent apps or closing its
   browser tab. Do not use Android **Force stop**. The report distinguishes no
   visible windows from no open ChessRiot windows.
5. If a round stalls, inspect its separate provider, device, notification,
   click and game-open stages. A displayed browser notification API result is
   not physical banner proof. Foreground, failed-display and missing evidence
   remain incomplete; use **Restart test** to retry cleanly.

Ending or restarting closes the diagnostic game, preventing its pending bot
reply. The test is capped at four rounds and expires after two hours. Exact-device
ownership is rechecked before the bot reply and send; normal multiplayer and
ordinary Solo behavior are unchanged. The same known hosting limit still
applies: interrupted continuations have no independent recurring wake.

Apply generated migration 0029 before running v0.28.0 with an existing standalone
or local database. Hosted publication applies it before uploading the Worker.


### v0.29.0 acceptance UI

Open `/notification-test` on the Android being tested. Tap **Start test**, then
**Send notification 1**. Immediately go Home or lock the phone; Riot Bot replies
in about eight seconds. Tap the real notification, then **Yes, I saw it and tapped
it**. Repeat all four rounds. Round three asks the player to close the app from
Recents or close its browser tab; do not use Force stop.

**Full test results** retains provider acceptance, attempt counts, all receipt
stage timestamps, visible/total window counts, device state and expiry. **View test
game** retains the real board and history. **Need help?** offers status refresh and
a fresh test. No round passes merely because the provider accepted a send. If
immutable evidence is invalid, or an earlier saved result is missing, restart the
test rather than attempting an extra move beyond the four-round limit.

Default UI is now English and LTR. Existing Hebrew usernames/user-authored content
remain unchanged. The UI change uses the existing 0029 schema with no new migration.

### v0.30.1 release verification

The local release gate includes `npm audit --omit=dev --audit-level=high`.
Do not promote until the immutable release commit also has green GitHub CI.
See [the PR #63–#67 follow-up](REVIEW-v0.30.1.md) for the verified audit failures
and review dispositions. Incoming challenge screens show whether White has
already moved before acceptance. Missing prior test evidence immediately offers
a restart, while all four complete round receipts remain required.
