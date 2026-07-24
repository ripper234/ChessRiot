# ChatGPT Work operating model

ChessRiot uses ChatGPT Work as the product and operations cockpit, Codex for
implementation and verification, GitHub as the canonical source, and Sites for
isolated hosted environments.

## Do

- Keep this repository's `AGENTS.md`, specifications, ADRs, test flows, and
  release manifests authoritative. Chat memory is supporting context, not the
  control plane.
- Use one project-level context boundary and one chat per concrete outcome.
  Continue a long-running implementation chat until its definition of done is
  reached.
- Use isolated write ownership. Parallel agents may research, audit rules,
  inspect security, or review tests, but they must not write the same checkout.
- Require an immutable Git commit, increasing SemVer, lint, typecheck, unit
  tests, integration tests, and browser verification before promotion.
- Promote one tested source state from Development to Staging to Production.
  Keep data and secrets isolated in Sites runtime configuration.
- Treat a successful Development deployment as part of finishing every changed
  release, not as a separate optional follow-up. Staging and Production advance
  only by promoting the exact healthy upstream release.
- Save and verify a Sites version before deployment. Treat every Sites URL as a
  production deployment surface, even when its product role is Development or
  Staging.
- Keep app-level structured telemetry because Sites analytics covers traffic,
  not ChessRiot's domain actions and rule failures.

## Avoid

- Relying on a large prompt or conversation memory for release rules.
- Editing Production directly or deploying an uncommitted workspace.
- Reusing a version after any changed deployment.
- Concurrent write agents in one checkout.
- Secrets in prompts, Git, `.openai/hosting.json`, URLs, or logs.
- A custom plugin before the workflow is stable and repeated enough to justify
  one.

## Official references

- [Work best practices](https://learn.chatgpt.com/docs/get-started-with-work)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Projects](https://learn.chatgpt.com/docs/projects)
- [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [GitHub integration](https://learn.chatgpt.com/docs/third-party/github)
- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Sites](https://learn.chatgpt.com/docs/sites)
- [Permissions](https://learn.chatgpt.com/docs/permission-modes)
