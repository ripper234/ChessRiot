# ADR 0004: ChatGPT Sites with Workers, D1, and R2

## Status

Accepted

The hosting and storage decisions remain current. The manual-only promotion
decision below is superseded by the v0.31.2 alpha release policy in `AGENTS.md`
and [deployment policy](../DEPLOYMENT_POLICY.md): validated releases may be
promoted after green GitHub CI under Ron's standing authorization.
[ADR 0006](0006-required-google-accounts-and-social-identity.md) supersedes
only this record's guest-identity consequences beginning with v0.19.0.

## Context

The early plan targeted Vercel, Supabase, mandatory accounts, and Standard-only
play. The released product instead uses guest private-seat capabilities,
server-authoritative variants, push notifications, owner observability, and two
isolated ChatGPT Sites environments.

## Decision

- Host Development and Production as separate ChatGPT Sites projects.
- Run one Vinext application in a Cloudflare Worker with isolated D1 and R2
  bindings per environment.
- Keep GitHub as canonical source and bind each release to an immutable commit
  plus release branch or tag.
- Deploy reviewed releases to Development. Production advances only through an
  explicit owner action in Control.
- Preserve guest play. Treat verified identity headers supplied by Sites as an
  optional server-side account portability signal, never as client authority.

## Consequences

- Vercel and Supabase are no longer active deployment dependencies.
- Database schema changes require checked-in migrations and artifact validation.
- Data, secrets, domains, and media remain target-local even though the Git tree
  is identical.
- Control is an independent owner-only Site and must not share end-user secrets.
- Google OAuth can add portability later without removing private seat links.
