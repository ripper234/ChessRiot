# ChessRiot Control

Owner-only deployment dashboard for the ChessRiot production, staging, and
development environments.

The dashboard reads each deployed app's public version marker. It deliberately
does not embed hosting credentials. Rollback controls prepare an exact request
for the protected ChatGPT deployment control plane.

Required runtime variables:

- `PROD_URL`
- `STAGING_URL`
- `DEV_URL`
- `PROD_BYPASS_TOKEN` (secret, optional while production is public)
- `STAGING_BYPASS_TOKEN` (secret)
- `DEV_BYPASS_TOKEN` (secret)
