# ChessRiot agent instructions

- SPEC.md and MVP.md are the product source of truth.
- Do not implement backlog features unless explicitly requested.
- Preserve separation between chess rules, persistence, UI, and future extensions.
- Every behavioral change must include tests and updated documentation.
- Every changed deployment must use a new, higher SemVer version. Run `npm run release:patch` by default, or `release:minor` for a coherent new user capability, before the deployment checkpoint. Never reuse or decrease a deployed version.
- Run lint, typecheck, unit tests, and relevant end-to-end tests.
- Never commit secrets.
- Play must never require or advertise sign-in. New games use private seat
  capabilities; existing verified account memberships remain a compatible
  authorization path.
- Do not add a CAPTCHA or separate human-check gate without an explicit product decision and a tested branch preview.
- Preserve game-specific membership plus private-seat authorization. A valid
  token may act through an existing membership, but no identity may own both
  seats.
- Keep identity-scoped write limits and the per-game/version Riot Bot lease on all expensive or mutating paths. Volumetric DDoS protection remains an edge responsibility.
- Prefer small, reviewable milestones over one giant implementation.
- GitHub is the canonical source. A deployable release must correspond to an immutable Git commit and release branch or tag.
- Promote the same tested source state from Development to Production. Never
  make environment-specific source edits; isolate only data, access, and
  runtime configuration.
- Completing a changed release always includes deploying the exact tested source to Development. Development tracks the newest release automatically.
- Small, low-risk changes may land on `main` and deploy directly to Development. Complicated or high-risk work belongs on `feature/*` and must use an isolated preview before merge.
- Promotion between environments is manual only. Development → Production
  requires Ron's explicit button click. A push, merge, passing test, successful
  build, agent action, scheduled job, or completed Dev deployment must never
  promote Production automatically.
- Keep `lib/changelog.ts` newest first and add one concise entry for every release before deployment.
- Every new important server action must be covered by the central request observer or emit a typed event through `recordEvent`. Never log names, tokens, token hashes, invitation/private URLs, URL fragments, IP addresses, user agents, FENs, raw bodies, or arbitrary exception messages.
- Preserve request correlation, environment, app version, bounded retention, and the rule that unchanged polling does not create telemetry. Account-wide move-alert polling through `/api/me/games` is an operational read and must remain excluded.
- Keep independent research/audit agents read-only. Only one agent edits a checkout at a time.
- Keep one ChatGPT Work chat per concrete outcome. Put durable requirements here or in the repository, never only in chat memory.
