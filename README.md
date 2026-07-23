# ChessRiot Control

Owner-only deployment dashboard for the ChessRiot production, staging, and
development environments.

The dashboard checks each deployment when the page opens and every five minutes
afterward. It probes immutable, release-specific stylesheet assets directly
from the owner's browser, avoiding unsupported Site-to-Site requests and keeping
hosting credentials out of the page. Reachability and version detection are
reported separately. Rollback controls prepare an exact request for the
protected ChatGPT deployment control plane.

Required runtime variables:

- `PROD_URL`
- `STAGING_URL`
- `DEV_URL`
