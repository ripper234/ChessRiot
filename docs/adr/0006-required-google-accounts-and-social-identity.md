# ADR 0006: Required Google accounts and social identity

## Status

Accepted for v0.19.0 and amended in v0.25.0 for multilingual usernames. This
ADR supersedes ADR 0005 and the guest-identity portions of ADR 0004. Those
records remain intact as release history.

## Context

The v0.18 account layer treated Google identity as optional portability while
private seat tokens remained complete guest capabilities. ChessRiot now needs
one dependable identity boundary for permanent usernames, friends, direct
challenges, automatic history, server-controlled feature access, and a distinct
signed-in home. Mixing account and guest authority makes those guarantees
ambiguous and can expose different behavior across devices.

## Decision

- Require a valid Google OpenID Connect session before creating, joining,
  reading, or mutating a game. Public marketing, demo, changelog, Privacy, and
  Terms routes remain available without a ChessRiot session.
- Require each new account to claim one immutable, globally unique username.
  The accepted form is 3–20 grapheme characters, begins with a Unicode letter,
  uses letters, marks, and numbers from any writing system plus internal ASCII
  dots, hyphens, and underscores, compares by one NFKC caseless canonical key,
  and rejects invisible formatting, reserved names, and profane lookalikes.
- Keep private invitation and seat tokens as game-specific seat selectors, not
  independent authorization. A recipient must sign in before claiming an
  offered seat, and one account may never own both colors.
- Store friends as account relationships initiated by exact username. Direct
  challenges require an accepted friendship and the invited friend's explicit
  acceptance; private-link invitations may be claimed by another registered
  account.
- Associate active and completed games with the account automatically and make
  server-backed dashboard and history views the normal resume path.
- Keep Magic Rules disabled by default. An owner-only, environment-specific
  server whitelist controls who may create new Magic games. The client may
  display the entitlement but the game-creation API makes the authoritative
  decision.
- Use the same application source and behavior in Development and Production.
  Keep OAuth clients, sessions, databases, Sites access policy, secrets, and
  Magic whitelists isolated per environment.

## Consequences

- Guest creation, guest joining, and private-seat-only access are no longer
  supported. A legacy private link can identify its exact seat only after the
  holder completes Google authentication.
- If required Google credentials are incomplete or unavailable, protected play
  fails closed instead of falling back to guest mode.
- Username changes and account switching are outside the current product. A
  player confirms the permanent choice during onboarding.
- Friend discovery does not expose Google email addresses and does not provide
  partial directory browsing.
- Privacy and Terms stay public for legal and OAuth-provider requirements but
  appear as subtle registration-flow links rather than homepage navigation.
