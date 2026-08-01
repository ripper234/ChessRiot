# ChessRiot Control

Owner-only, pipeline-first view of ChessRiot Development and Production.

The dashboard keeps an operational registry in its own D1, but visible versions
come only from the current page check. Opening, refreshing, or starting a
five-minute check immediately shows `—`; a version appears only after that
environment responds. Cached, bundled, and persisted versions never flash as
current data. Short-lived, environment-specific grants protect telemetry
without putting long-lived secrets in page source or browser storage.

The first viewport is intentionally narrow in scope: `Dev → Prod`, currently
verified versions, quick-open links, and the manual promotion state. Dev itself
is the automatically updated latest environment. A compact message icon at the
top right stays subdued when no concrete unresolved feedback record is loaded.
Only an actual visible unresolved message adds a red numbered badge. An
incomplete environment read may tint the launcher gold, but never produces a
red question-mark badge. The right-side inbox reads feedback from both
environments, keeps completed items collapsed, and uses a fresh,
environment-scoped `feedback:manage` grant to mark one item done. Environments
without the matching backend release remain explicitly unavailable. Health,
telemetry, and events stay collapsed until they are needed. Release history
lives on the public
[Releases page](https://chessriot.gg/changelog).

The release policy is intentionally asymmetric:

- Every changed release deploys automatically to Development.
- Development → Production requires an explicit manual promotion click.
- Pushes, merges, tests, successful builds, agents, and schedules must never
  promote to Production.

The Control Worker currently has no credential, webhook, or callable Sites API
that can deploy another project. It therefore does not claim to promote
releases. As a temporary workaround, promotion and version-switch controls
prepare an exact ChatGPT Work request for the owner to copy and paste; Control
does not perform the deployment. Scoped deployment authority and an immutable
cross-environment release catalog are still required for true one-click
upgrades and rollbacks; that work is tracked in
[ChessRiot issue #22](https://github.com/ripper234/ChessRiot/issues/22).

The top pipeline provides immediate launch links for every environment.
Each environment remains isolated, and missing telemetry is never replaced by
zeroes or demo data.

The collapsed Demo video drawer is an independent media workflow. Its owner-only
button creates one fixed, story-first 90-second Dev explainer in the browser,
obtains a server-side AI narration, burns captions into the recording, validates
the result, and publishes it to the Dev site's object storage. A recipe version
is signed across narration and publishing so an older Control build cannot
replace the current story. It never receives Sites deployment authority and
does not redeploy the game.

The collapsed AI cost and waste dashboard keeps development/build usage first,
then runtime usage. It reports total tracked tokens separately from objectively
classified avoidable tokens, trends them over time, and groups them by game
version. Missing sources, pricing, and classification remain visible as gaps or
lower bounds. Historical build totals cannot be reconstructed, and stable
gameplay's expected zero LLM calls per move is not presented as a measured zero.
Usage sources write idempotent events to Control's append-only D1 ledger through
`POST /api/financials/events`.

## Control changelog

- `0.8.0`: Secured status grants and deployment observations with the exact
  authenticated owner identity, blocked cross-site registry writes, validated
  Dev and Prod origins and secret strength, derived CSP connections from those
  origins, added a read-only Control health check, removed stale preview data,
  fixed the browser startup crash and local POST forwarding, and moved Control
  links to the `chessriot.gg` domains.
- `0.7.0`: Retired Staging from the active pipeline and feedback aggregation.
  The notification badge now turns red only for concrete unresolved records
  that are actually present in the inbox.
- `0.6.0`: Added the development-first AI cost and waste dashboard, append-only
  per-version token ledger, explicit waste classification, time trends, runtime
  cause breakdowns, and honest uninstrumented states.
- `0.5.0`: Added a compact top-right unresolved-feedback notification, one
  cross-environment inbox, and scoped Mark done actions with honest
  partial-rollout states.
- `0.4.4`: Reduced every copied promotion, upgrade, or rollback request to two
  short lines that rely on ChatGPT's existing ChessRiot release context.
- `0.4.3`: Restored an explicitly manual ChatGPT Work handoff for exact
  promotions and per-environment version switches while keeping direct
  deployment unavailable and issue #22 open.
- `0.4.2`: Rebuilt the demo around Ron and Omri's asynchronous match, added the
  joined-game and replay scenes, and bound narration and publishing to story
  recipe v2.
- `0.4.1`: Corrected the Production Releases link to open the public changelog
  instead of the nonexistent `/releases` route.
- `0.4.0`: Added the owner-only, rate-limited 90-second demo-video generator,
  live rendering progress, validated asset publishing, and a direct demo link.
- `0.3.8`: Reduced each promotion boundary to one directional arrow, corrected
  Development to use its owner-only credentials during health checks, and made
  the blocked per-environment version-switch requirement explicit.
- `0.3.7`: Updated the isolated Magic preview card to the refactor-merged
  `0.11.0-magic.4` checkpoint.
- `0.3.6`: Added a collapsed Feature Previews drawer with the isolated
  `feature/runtime-magic-rules` branch, its prerelease version, direct preview,
  and GitHub branch links.
- `0.3.5`: Reduced the pipeline to exactly Dev, Staging, and Prod. Dev is now
  visibly the automatic latest environment, with only the two real promotion
  boundaries left in the interface.
- `0.3.4`: Stopped treating matching SemVer labels as proof of identical builds.
  Equal labels now remain explicitly build-unverified until immutable release
  identity is available.
- `0.3.3`: Kept explicit `Promote →` controls visible between Development,
  Staging, and Production in every pipeline state, including while checking and
  when environments are already synchronized. Controls remain safely disabled
  until scoped Sites deployment authority is connected.
- `0.3.2`: Added safe spacing around italic pipeline versions and responsive
  sizing so complete version numbers render without clipped glyphs.
- `0.3.1`: Removed visible cached and hard-coded versions, added strict
  check-then-render behavior, linked the public Releases page, and simplified
  section headings and feedback counts.
- `0.3.0`: Rebuilt the primary view around the compact release pipeline,
  collapsed operational detail, and replaced copy-prompt deployment language
  with a truthful deployment-authority state.
- `0.2.8`: Preserved deployed-version truth independently from health checks.

Required runtime variables:

- `CONTROL_OWNER_EMAIL`, the exact email supplied by the Sites authenticated
  identity header.
- `PROD_URL=https://chessriot.gg`
- `DEV_URL=https://dev.chessriot.gg`
- `PROD_OPS_READ_SECRET`, at least 32 characters.
- `DEV_OPS_READ_SECRET`, at least 32 characters.

Optional runtime variable:

- `FINANCIALS_INGEST_SECRET` for authenticated server-to-server token-event
  ingestion. Each event must include an idempotent `source` + `sourceEventId`,
  `scope` (`development` or `runtime`), timestamp, purpose, input and output
  tokens, and may include version, environment, model, cached and reasoning
  details, estimated cost, and a named avoidable-token rule.

Demo-video runtime variables:

- `VIDEO_REGEN_ALLOWED_EMAIL`, the exact owner email allowed to spend narration
  budget.
- `VIDEO_REGEN_SHARED_SECRET`, a secret shared only with ChessRiot Dev for
  authenticated narration and publishing requests.
- `DEV_SITES_BYPASS_TOKEN`, the server-only Sites bearer used to traverse the
  owner-gated Development edge. It is never returned to the browser.
