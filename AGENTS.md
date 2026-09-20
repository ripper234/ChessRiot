# ChessRiot agent instructions

- SPEC.md and MVP.md are the product source of truth.
- Do not implement backlog features unless explicitly requested.
- Preserve separation between chess rules, persistence, UI, and future extensions.
- Default app copy, loading/recovery states and presentation callsites to English/LTR. Preserve user-authored language and bidirectional isolation.
- Every behavioral change must include tests and updated documentation.
- Every changed deployment must use a new, higher SemVer version. Run `npm run release:patch` by default, or `release:minor` for a coherent new user capability, before the deployment checkpoint. Never reuse or decrease a deployed version.
- Run lint, typecheck, unit tests, and relevant end-to-end tests.
- Never commit secrets.
- A valid Google session and completed username onboarding are prerequisites
  for creating, joining, opening, or playing a game. Public marketing, demo,
  changelog, Privacy, and Terms routes remain available without a session.
- Do not add a CAPTCHA or separate human-check gate without an explicit product decision and a tested branch preview.
- Require each new account to claim one immutable, globally unique username.
  Usernames are 3–20 grapheme characters, begin with a Unicode letter, use
  letters and numbers from any writing system plus internal ASCII dots,
  hyphens, or underscores, and pass reserved-name and profanity checks.
  Canonical uniqueness uses the shared Unicode normalizer; never add an ASCII
  regex, code-unit length gate, or ad-hoc lowercase comparison.
- Preserve game-specific membership plus private invitation and seat tokens,
  but never treat a token as a substitute for account authentication. A valid
  Google account may claim only the exact offered seat, and no account may own
  both seats.
- Keep friend requests username-based and account-scoped. Only accepted friends
  may be selected for a direct challenge; link invitations remain available to
  another registered player.
- Keep Magic Rules disabled by default. Only an owner-managed, server-side
  account whitelist may enable new Magic game creation. Non-whitelisted users
  see Coming Soon, while participants may continue any already-created game.
- Keep Google OAuth on the canonical custom hostname with exact per-environment
  callback URLs and separate client, client-secret, and session-secret values.
  Development keeps its Sites user allowlist; never make it public merely to
  accommodate the browser callback.
- Keep identity-scoped write limits and the per-game/version Riot Bot lease on all expensive or mutating paths. Volumetric DDoS protection remains an edge responsibility.
- Prefer small, reviewable milestones over one giant implementation.
- GitHub is the canonical source. A deployable release must correspond to an immutable Git commit and release branch or tag.
- Promote the same tested source state from Development to Production. Never
  make environment-specific source edits; isolate only data, access, and
  runtime configuration.
- Completing a changed release always includes deploying the exact tested source to Development. Development tracks the newest release automatically.
- Small, low-risk changes may land on `main` and deploy directly to Development. Complicated or high-risk work belongs on `feature/*` and must use an isolated preview before merge.
- Promotion between environments requires Ron's explicit approval, either by
  clicking the Control promotion action or by authorizing production deployment
  in the current chat. An agent may carry out that approved promotion after
  Development validation. A push, merge, passing test, successful build,
  scheduled job, or completed Dev deployment alone never authorizes Production.
- Keep `lib/changelog.ts` newest first and add one concise entry for every release before deployment.
- Every new important server action must be covered by the central request observer or emit a typed event through `recordEvent`. Never log names, tokens, token hashes, invitation/private URLs, URL fragments, IP addresses, user agents, FENs, raw bodies, or arbitrary exception messages.
- Preserve request correlation, environment, app version, bounded retention, and the rule that unchanged polling does not create telemetry. Account-wide move-alert polling through `/api/me/games` is an operational read and must remain excluded.
- Keep independent research/audit agents read-only. Only one agent edits a checkout at a time.
- Keep one ChatGPT Work chat per concrete outcome. Put durable requirements here or in the repository, never only in chat memory.
