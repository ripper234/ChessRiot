# ChessRiot deployment policy

## Invariant

Code moves automatically in only one direction: from a changed, tested source
state to Development.

Every promotion beyond Development is initiated manually by Ron:

1. Development → Staging requires an explicit Control-panel click.
2. Staging → Production requires a second explicit Control-panel click.

No push, merge, passing test, successful build, agent action, scheduled job,
health check, or completed deployment may trigger either promotion.

The legacy Vercel Git integration is disabled in `vercel.json`. ChessRiot's
active environments are ChatGPT Sites projects, so Vercel must not create a
parallel automatic Production deployment from repository pushes.

## Release rules

- Build and test one immutable source state.
- Deploy that state automatically to Development.
- Keep Staging and Production unchanged until the corresponding manual click.
- Promote the exact same source state, without environment-specific source
  edits or rebuilds.
- Preserve each environment’s isolated data and runtime configuration.
- Keep arbitrary-version deploys and rollbacks behind the advanced manual flow.

## Control-panel behavior

- Development displays automatic deployment status and has no primary deploy
  button.
- Staging’s primary button manually promotes the exact Development version.
- Production’s primary button manually promotes the exact Staging version.
- Specific-version changes always require a separate manual action.
