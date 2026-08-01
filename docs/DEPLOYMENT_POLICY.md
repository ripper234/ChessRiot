# ChessRiot deployment policy

## Invariant

Code moves automatically in only one direction: from a changed, tested source
state to Development.

Every promotion beyond Development is initiated manually by Ron:

1. Development → Production requires an explicit Control-panel click.

No push, merge, passing test, successful build, agent action, scheduled job,
health check, or completed deployment may trigger that promotion.

The legacy Vercel Git integration is disabled in `vercel.json`. ChessRiot's
active environments are ChatGPT Sites projects, so Vercel must not create a
parallel automatic Production deployment from repository pushes.

## Release rules

- Build and test one immutable source state.
- Deploy that state automatically to Development.
- Keep Production unchanged until the manual promotion click.
- Build each target from the same immutable application tree and verified
  lockfile. `.openai/hosting.json` is a target adapter: only its Site project id
  may differ, while D1 must remain `DB` and R2 must remain `BUCKET`. The build
  records application, lockfile, migration, portable-manifest, and target-
  manifest SHA-256 fingerprints so the Work promotion step can prove the
  allowed difference. Surfacing this comparison in Control remains follow-up.
- Target-local builds may inject only the target Site id, declared bindings,
  public configuration, and secrets. They may not edit application source.
- Preserve each environment’s isolated data and runtime configuration.
- Keep arbitrary-version deploys and rollbacks behind the advanced manual flow.

## Two development lanes

- Small, low-risk changes land on `main` and deploy automatically to
  Development after the full release gate.
- Complicated or high-risk work stays on `feature/*` and receives an isolated
  local Sites preview. A feature branch alone does not deploy anything.
- A local preview can be reviewed and updated, but never promoted directly to
  Production. Hosted feature previews remain deferred until the release tool
  has a separate prerelease channel (backlog CR-012).
- Merging the reviewed branch creates a normal stable release on `main`, which
  is then verified independently in Development.

## Preview invariants

- Local previews are non-deploying review surfaces identified by their
  `terminal.local` URL and checkout. They use disposable local D1/R2 state, no
  Production secrets, and no release announcements.
- The package version remains the last stable release until the reviewed branch
  is prepared for merge. The stable version is bumped before the final release
  gate and Development deployment.
- Do not use a public Sites checkpoint as a feature preview until the repository
  can label prerelease builds and Control can distinguish them from releases.

## Control-panel behavior

- Development displays automatic deployment status and has no primary deploy
  button.
- Production’s primary button manually promotes the exact Development version.
- Specific-version changes always require a separate manual action.

## Demo-video media releases

- Adding or changing the `/demo` application route follows the normal source
  release path.
- Regenerating the fixed 90-second video publishes only validated R2 media and
  its manifest. It does not deploy source or promote any environment.
- The previous video remains active unless the replacement upload completes.
- Development video regeneration never changes Production media.
