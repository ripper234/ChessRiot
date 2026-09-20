# Security policy

## Magic World boundaries

- World codes are public content identifiers, never authentication
  capabilities. Game seats and invitations retain separate unguessable tokens.
- The compiler uses the existing strict schema, no tools, no executable output,
  bounded prompt size, rate limits, durable leases, and `store: false`.
- Raw prompts do not enter public World, graph, game, recap, analytics, or log
  payloads. The World hash covers executable canonical semantics only.
- A creator can export per-World popularity and royalty totals, never private
  game identifiers or activity timestamps belonging to other players.
- Credit writes are append-only, source-key unique, and tied to an account and
  exact fingerprinted game-create request. The debit precedes compilation;
  retries reuse it, mismatched payloads fail closed, failures refund once, and
  one entitlement cannot fund multiple games. A paid request is persisted
  locally before transmission so interruption can retry the same opaque ID.
- Google-established application sessions slide for one year, but their
  immutable authentication timestamp continues to guard recent-auth account
  deletion. Dev's outer Sites access gate remains a separate platform session.

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
- Optional Google identity uses server-side Authorization Code, PKCE, signed
  state, nonce, exact callbacks, and library-verified OpenID Connect tokens.
  The durable account key is a versioned HMAC of Google `sub`; raw subjects,
  email addresses, and provider tokens are not persisted.
- Google sessions use signed Secure, HTTP-only, host-only, SameSite=Lax
  cookies. Development and Production have separate client credentials and
  separate session-signing secrets. Missing or mismatched configuration hides
  account login while guest private-seat play continues.
- Exact private-seat tokens remain complete, game-specific capabilities.
  Google account membership is an additional authorization path for games the
  account owns.
- A Google account can replace an existing guest membership only through an
  explicit same-origin action presenting the exact private seat token. An
  ordinary game load never links ownership. The action cannot claim through a
  browser guest identifier, replace a non-guest owner, or own both colors.
- The Development Sites allowlist remains outside and in front of application
  OAuth. Only admitted Dev users can start or receive its browser callback.
- New Magic prompts are available only to server-enabled accounts through the
  bounded Apply endpoint. Compiled and legacy rule documents are immutable,
  validated data and are never executed as code.
- Secrets live only in each Site's secret manager. Development, Production, and
  Control use separate data and runtime configuration.
- Telemetry excludes names, emails, tokens, hashes of tokens, invitation URLs,
  fragments, IP addresses, user agents, FENs, raw bodies, and arbitrary error
  messages. Hosted identifiers require an environment-local HMAC secret.
- Mutation bodies are bounded, rate limits protect application resources, and
  the hosting edge remains responsible for volumetric denial-of-service defense.
- The owner-only OpenAI smoke call sends one fixed marker and no player, game,
  feedback, or private-link data. Environment-specific OpenAI keys are never
  selected across the Development/Production boundary.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for readiness and incident checks.
