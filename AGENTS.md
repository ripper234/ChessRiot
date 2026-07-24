# ChessRiot agent instructions

- SPEC.md and MVP.md are the product source of truth.
- Do not implement backlog features unless explicitly requested.
- Preserve separation between chess rules, persistence, UI, and future extensions.
- Every behavioral change must include tests and updated documentation.
- Every changed deployment must use a new, higher SemVer version. Run `npm run release:patch` by default, or `release:minor` for a coherent new user capability, before the deployment checkpoint. Never reuse or decrease a deployed version.
- Run lint, typecheck, unit tests, and relevant end-to-end tests.
- Never commit secrets.
- Prefer small, reviewable milestones over one giant implementation.
- GitHub is the canonical source. A deployable release must correspond to an immutable Git commit and release branch or tag.
- Promote the same tested source state through Development, Staging, and Production. Never make environment-specific source edits; isolate only data, access, and runtime configuration.
- Completing a changed release always includes deploying the exact tested source to Development. Development tracks the newest release automatically.
- Promotion between environments is manual only. Development → Staging requires Ron's explicit button click, and Staging → Production requires Ron's explicit button click. A push, merge, passing test, successful build, agent action, scheduled job, or completed Dev deployment must never promote Staging or Production automatically.
- Keep `lib/changelog.ts` newest first and add one concise entry for every release before deployment.
- Every new important server action must be covered by the central request observer or emit a typed event through `recordEvent`. Never log names, tokens, token hashes, invitation/private URLs, URL fragments, IP addresses, user agents, FENs, raw bodies, or arbitrary exception messages.
- Preserve request correlation, environment, app version, bounded retention, and the rule that unchanged three-second polls do not create telemetry.
- Keep independent research/audit agents read-only. Only one agent edits a checkout at a time.
- Keep one ChatGPT Work chat per concrete outcome. Put durable requirements here or in the repository, never only in chat memory.
