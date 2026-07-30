# ChessRiot Control agent instructions

- Every changed Control deployment must use a new, higher SemVer version.
- Control and game versions are independent. Never add a Control release to the
  game `RELEASES` history.
- Run `npm run build` and `npm run validate` before every Control checkpoint.
- Preserve `.openai/hosting.json`, the Control D1 registry, access policy, runtime
  bindings, and environment isolation.
- Control never deploys game code. Every changed game release is checkpointed to
  Development, and Production advances only after an explicit Development
  promotion.
- Do not present prompt copying as deployment automation. Until Control receives
  scoped Sites deployment authority, direct promotion and arbitrary version
  actions must remain visibly unavailable. A temporary ChatGPT Work handoff may
  be offered only when it is explicitly labeled as a manual copy-paste
  workaround and never claims that Control performed the deployment.
- Keep the primary viewport pipeline-first. Health, telemetry, events, and
  feedback remain secondary, collapsed surfaces. Public history belongs on the
  game Releases page.
- Keep both top-pipeline environment launch controls visible even while
  deployment or health status is loading.
- Persisted deployment truth may support backend reconciliation, but it must
  never render as a current version. Each check cycle starts with `—`; only a
  response received during that cycle may populate visible versions or metrics.
- Never commit secrets. Keep independent research agents read-only and use one
  source writer per checkout.
