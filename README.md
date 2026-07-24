# ChessRiot Control

Owner-only deployment dashboard for the ChessRiot Development, Staging, and
Production release pipeline.

The dashboard keeps deployment state and last-known health in its own D1
registry, separate from each live health probe. Runtime metadata seeds and
atomically advances that registry after a deployment. A failed or access-blocked
probe can never turn a deployed environment into "not deployed." It checks
health when the page opens and every five minutes afterward. Short-lived,
environment-specific signed grants protect telemetry without putting long-lived
secrets in page source or browser storage.

The default release path is Development → Staging → Production. Primary actions
prepare the exact promotion request for the protected ChatGPT deployment
control plane; arbitrary version changes remain available under Advanced.
Each environment remains isolated, and missing telemetry is never replaced by
zeroes or demo data.

Required runtime variables:

- `PROD_URL`
- `STAGING_URL`
- `DEV_URL`
- `PROD_DEPLOYED_VERSION` (fallback: `0.3.2`)
- `STAGING_DEPLOYED_VERSION` (fallback: `0.3.2`)
- `DEV_DEPLOYED_VERSION` (fallback: `0.3.2`)
- `PROD_OPS_READ_SECRET`
- `STAGING_OPS_READ_SECRET`
- `DEV_OPS_READ_SECRET`

Optional runtime variable:

- `DEPLOYMENT_STATE_JSON` for deployment and verification timestamps. Individual
  `*_DEPLOYED_VERSION` values override the corresponding version in this JSON.
