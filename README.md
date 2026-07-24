# ChessRiot Control

Owner-only deployment dashboard for the ChessRiot production, staging, and
development environments.

The dashboard checks each deployment when the page opens and every five minutes
afterward. It reads each environment's real health and privacy-safe
observability endpoints directly from the owner's browser. Short-lived,
environment-specific signed grants protect telemetry without putting long-lived
secrets in page source or browser storage.

Each environment remains isolated. A failed refresh preserves the last good
snapshot with a visible stale state and never replaces missing data with zeroes
or demo data. Release controls prepare an exact request for the protected
ChatGPT deployment control plane.

Required runtime variables:

- `PROD_URL`
- `STAGING_URL`
- `DEV_URL`
- `PROD_OPS_READ_SECRET`
- `STAGING_OPS_READ_SECRET`
- `DEV_OPS_READ_SECRET`
