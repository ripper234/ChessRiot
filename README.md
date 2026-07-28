# ChessRiot Control

Owner-only, pipeline-first view of ChessRiot Development, Staging, and
Production.

The dashboard keeps an operational registry in its own D1, but visible versions
come only from the current page check. Opening, refreshing, or starting a
five-minute check immediately shows `—`; a version appears only after that
environment responds. Cached, bundled, and persisted versions never flash as
current data. Short-lived, environment-specific grants protect telemetry
without putting long-lived secrets in page source or browser storage.

The first viewport is intentionally narrow in scope: `Dev → Staging → Prod`,
currently verified versions, quick-open links, and the two manual promotion
states. Dev itself is the automatically updated latest environment; there is no
stage before it. A compact message icon at the top right stays subdued when all
three environments report zero unresolved feedback. New or reviewed feedback
adds a high-contrast count; incomplete environment reads show a lower bound or
question mark instead of a false zero. The right-side inbox reads feedback from
all environments, keeps completed items collapsed, and uses a fresh,
environment-scoped `feedback:manage` grant to mark one item done. Environments
without the matching backend release remain explicitly unavailable. Health,
telemetry, and events stay collapsed until they are needed. Release history
lives on the public
[Releases page](https://chessriot.ripper234.chatgpt.site/changelog).

The release policy is intentionally asymmetric:

- Every changed release deploys automatically to Development.
- Development → Staging requires an explicit manual promotion click.
- Staging → Production requires an explicit manual promotion click.
- Pushes, merges, tests, successful builds, agents, and schedules must never
  promote to Staging or Production.

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

## Control changelog

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

- `PROD_URL`
- `STAGING_URL`
- `DEV_URL`
- `PROD_DEPLOYED_VERSION`
- `STAGING_DEPLOYED_VERSION`
- `DEV_DEPLOYED_VERSION`
- `PROD_OPS_READ_SECRET`
- `STAGING_OPS_READ_SECRET`
- `DEV_OPS_READ_SECRET`

Optional runtime variable:

- `DEPLOYMENT_STATE_JSON` for deployment and verification timestamps. Individual
  `*_DEPLOYED_VERSION` values override the corresponding version in this JSON.

Demo-video runtime variables:

- `VIDEO_REGEN_ALLOWED_EMAIL`, the exact owner email allowed to spend narration
  budget.
- `VIDEO_REGEN_SHARED_SECRET`, a secret shared only with ChessRiot Dev for
  authenticated narration and publishing requests.
- `DEV_SITES_BYPASS_TOKEN`, the server-only Sites bearer used to traverse the
  owner-gated Development edge. It is never returned to the browser.
