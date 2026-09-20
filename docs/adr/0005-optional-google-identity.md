# ADR 0005: Optional Google identity with explicit private-seat linking

## Status

Accepted for v0.18.0, then superseded by
[ADR 0006](0006-required-google-accounts-and-social-identity.md) for v0.19.0.
The decision below is retained as the historical contract for the v0.18
release line.

## Decision

ChessRiot keeps exact private-seat tokens as complete game capabilities and
adds Google OpenID Connect as optional cross-device identity. The server uses
Authorization Code with PKCE, validates the ID token with `jose`, and derives a
durable account ID from a versioned HMAC of Google `sub`. Email is verified for
the login ceremony but is not the durable key or persisted profile data.

Development and Production use exact canonical callbacks and separate client,
client-secret, and ChessRiot session-secret values. The Development Sites
allowlist remains in front of the entire app, including its callback.

A Google session may take over an existing guest membership only through an
explicit same-origin account-link action that supplies that seat's private
token. Ordinary game requests never change ownership. Browser guest identity
is never a claim capability. The transfer also moves matching push
associations and refuses an existing non-guest owner or opposite-seat
ownership.

## Consequences

- Guest play and private links keep working without Google configuration.
- Signed-in creates, joins, and explicitly linked games appear across devices
  through existing account tables.
- Sign-out removes account-only access immediately while exact private links
  keep working.
- No schema migration or provider-token storage is required.
- OAuth configuration remains isolated by environment; incomplete account
  configuration does not cross credentials or break guest play.
