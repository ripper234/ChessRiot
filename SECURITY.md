# Security policy

## Reporting

Please use a private
[GitHub security advisory](https://github.com/ripper234/ChessRiot/security/advisories/new)
for suspected vulnerabilities. Do not include live secrets, private game links,
player data, or exploit details in a public issue.

## Supported version

The newest Production release receives security fixes. Development may contain
the next reviewed release and is not a compatibility target.

## Security boundaries

- The server revalidates membership, private-seat capability, turn, expected
  version, chess legality, and mutation idempotency. Browser state is advisory.
- Private seat and invitation credentials remain in URL fragments or request
  headers and are never logged. Stored capabilities are SHA-256 hashes.
- Verified identity headers are consumed only server-side when the Sites
  platform supplies them. The browser cannot grant itself membership.
- New Magic prompts are disabled. Stored legacy rule documents are immutable,
  allowlisted data and are never executed as code.
- Secrets live only in each Site's secret manager. Development, Production, and
  Control use separate data and runtime configuration.
- Telemetry excludes names, emails, tokens, hashes of tokens, invitation URLs,
  fragments, IP addresses, user agents, FENs, raw bodies, and arbitrary error
  messages. Hosted identifiers require an environment-local HMAC secret.
- Mutation bodies are bounded, rate limits protect application resources, and
  the hosting edge remains responsible for volumetric denial-of-service defense.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for readiness and incident checks.
