# ChessRiot deployment policy

## Alpha release policy

ChessRiot is currently alpha. Prioritize rapid, small releases and feedback
over stable-production ceremony. Production is the live alpha environment.

Ron has given standing authorization for agents to publish requested changes:
validate the immutable release in Development, wait for green GitHub CI on that
exact commit, then promote it to Production without asking again. Honor any
later instruction that pauses or limits deployment. Control remains an optional
manual route. This policy supersedes older per-release approval requirements.

The legacy Vercel Git integration is disabled in `vercel.json`. ChessRiot's
active environments are ChatGPT Sites projects, so Vercel must not create a
parallel automatic Production deployment from repository pushes.

## Release rules

- Build and test one immutable source state.
- Deploy that state automatically to Development.
- Promote the validated Development release after green GitHub CI; no additional
  owner approval is required for routine alpha releases.
- Use CI as the complete release gate, run focused checks locally, and reuse
  successful results for unchanged inputs across environments.
- Build each target from the same immutable application tree and verified
  lockfile. `.openai/hosting.json` is a target adapter: only its Site project id
  may differ, while D1 must remain `DB` and R2 must remain `BUCKET`. The build
  records application, lockfile, migration, portable-manifest, and target-
  manifest SHA-256 fingerprints so the Work promotion step can prove the
  allowed difference. Surfacing this comparison in Control remains follow-up.
- Target-local builds may inject only the target Site id, declared bindings,
  public configuration, and secrets. They may not edit application source.
- Preserve each environment’s isolated data and runtime configuration.
- Keep player-visible behavior identical across Development and Production for
  the promoted version. Environment-local Google credentials, Sites access,
  account data, and Magic whitelist membership are configuration or data, not
  permission for environment-specific source edits.
- Keep the previous immutable version available for rollback.

## Two development lanes

- Small, low-risk changes land on `main` and deploy to Development after focused
  validation and artifact checks. The full GitHub CI gate must pass before Production.
- Complicated or high-risk work stays on `feature/*` and receives an isolated
  local Sites preview. A feature branch alone does not deploy anything.
- A local preview can be reviewed and updated, but never promoted directly to
  Production. Hosted feature previews remain deferred until the release tool
  has a separate prerelease channel (backlog CR-012).
- Merging the reviewed branch creates a normal alpha release on `main`, which
  is then verified independently in Development.

## Preview invariants

- Local previews are non-deploying review surfaces identified by their
  `terminal.local` URL and checkout. They use disposable local D1/R2 state, no
  Production secrets, and no release announcements.
- The package version remains the last release until the reviewed branch
  is prepared for merge. The version is bumped before the final release
  gate and Development deployment.
- Do not use a public Sites checkpoint as a feature preview until the repository
  can label prerelease builds and Control can distinguish them from releases.

## Control-panel behavior

- Development displays automatic deployment status and has no primary deploy
  button.
- Production’s primary button offers manual promotion of the exact Development
  version; agents may also promote it under the standing alpha authorization.
- Specific-version rollback remains available through the advanced controls.

## Demo-video media releases

- Adding or changing the `/demo` application route follows the normal source
  release path.
- Regenerating the fixed 90-second video publishes only validated R2 media and
  its manifest. It does not deploy source or promote any environment.
- The previous video remains active unless the replacement upload completes.
- Development video regeneration never changes Production media.
