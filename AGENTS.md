# ChessRiot Control agent instructions

- Every changed Control deployment must use a new, higher SemVer version.
- Control and game versions are independent. Never add a Control release to the
  game `RELEASES` history.
- Run `npm run build` and `npm run validate` before every Control checkpoint.
- Preserve `.openai/hosting.json`, the Control D1 registry, access policy, runtime
  bindings, and environment isolation.
- Control never deploys game code. Every changed game release is checkpointed to
  Development; Staging advances only after an explicit Development promotion,
  and Production advances only after an explicit Staging promotion.
- Keep the three top-pipeline environment launch controls visible even while
  deployment or health status is loading.
- A failed health check must never erase or replace persisted deployment truth.
- Never commit secrets. Keep independent research agents read-only and use one
  source writer per checkout.
