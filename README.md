# ChessRiot Control

Owner-only, pipeline-first view of ChessRiot Development, Staging, and
Production.

The dashboard keeps an operational registry in its own D1, but visible versions
come only from the current page check. Opening, refreshing, or starting a
five-minute check immediately shows `—`; a version appears only after that
environment responds. Cached, bundled, and persisted versions never flash as
current data. Short-lived, environment-specific grants protect telemetry
without putting long-lived secrets in page source or browser storage.

The first viewport is intentionally narrow in scope: `Latest → Development →
Staging → Production`, currently verified versions, quick-open links, and the
next promotion state. Health, telemetry, events, and feedback stay collapsed
until they are needed. Release history lives on the public
[Releases page](https://chessriot.ripper234.chatgpt.site/releases).

The release policy is intentionally asymmetric:

- Every changed release deploys automatically to Development.
- Development → Staging requires an explicit manual promotion click.
- Staging → Production requires an explicit manual promotion click.
- Pushes, merges, tests, successful builds, agents, and schedules must never
  promote to Staging or Production.

The Control Worker currently has no credential, webhook, or callable Sites API
that can deploy another project. It therefore does not claim to promote
releases and no longer offers a copy-prompt handoff. Promotion controls show
the exact next release but remain unavailable until scoped deployment authority
is connected.

The top pipeline provides immediate launch links for every environment.
Each environment remains isolated, and missing telemetry is never replaced by
zeroes or demo data.

## Control changelog

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
