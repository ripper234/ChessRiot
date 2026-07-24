# ChessRiot agent instructions

- SPEC.md and MVP.md are the product source of truth.
- Do not implement backlog features unless explicitly requested.
- Preserve separation between chess rules, persistence, UI, and future extensions.
- Every behavioral change must include tests and updated documentation.
- Every changed deployment must use a new, higher SemVer version. Run `npm run release:patch` by default, or `release:minor` for a coherent new user capability, before the deployment checkpoint. Never reuse or decrease a deployed version.
- Run lint, typecheck, unit tests, and relevant end-to-end tests.
- Never commit secrets.
- Prefer small, reviewable milestones over one giant implementation.
