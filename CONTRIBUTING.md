# Contributing to ChessRiot

## Setup

Use Node `22.13.0` and npm `11.9.0`, then install the exact lockfile:

```bash
npm ci
```

Do not commit `.env` files, credentials, private seat links, generated local
databases, build output, or browser profiles. Public variable names and safe
examples belong in `.env.example`.

## Development

```bash
npm run dev
npm run lint
npm run typecheck
npm test
```

Behavioral changes need focused unit or end-to-end coverage and updates to
`SPEC.md`, `MVP.md`, `BACKLOG.md`, or an ADR as appropriate. Keep chess rules,
persistence, transport, and presentation separate.

## Pull requests and releases

1. Use a `feature/*` branch for large or high-risk work and verify it in an
   isolated local Sites preview before merge.
2. Run `npm run release:patch` for a compatible fix or `release:minor` for a
   coherent new capability. Add the newest entry to `lib/changelog.ts`.
3. Run `npm run build`. This is the complete local release gate.
4. Open a pull request and wait for CI. Never merge with a failing gate.
5. Create the immutable `release/vX.Y.Z` branch or tag and deploy that exact
   tree to Development.
6. Verify Development health and the relevant browser flows. Production
   changes only after an explicit owner promotion in Control.

Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md),
not a public issue.
