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

## Two development lanes

- Small, low-risk changes land on `main` and deploy automatically to
  Development after the full release gate.
- Complicated or high-risk work stays on `feature/*` and receives an isolated,
  opt-in Preview. A feature branch alone does not deploy anything.
- A Preview can be reviewed and updated, but never promoted directly to
  Staging or Production.
- Merging the reviewed branch creates a normal stable release on `main`, which
  is then verified independently in Development.

## Preview environment invariants

- Each Preview has isolated runtime configuration and data. It receives no
  Staging or Production secrets and sends no release announcements.
- Preview builds display a visible `PREVIEW` label, branch, prerelease version,
  and exact commit.
- Control keeps previews collapsed under `Feature Previews (N)` and shows only
  active previews unless history is requested.
- Preview health starts at `— / Checking…` and is populated only by a fresh
  check.
- Closing a Preview removes its runtime resources while retaining a small audit
  record.

## Control-panel behavior

- Development displays automatic deployment status and has no primary deploy
  button.
- Staging’s primary button manually promotes the exact Development version.
- Production’s primary button manually promotes the exact Staging version.
- Specific-version changes always require a separate manual action.
