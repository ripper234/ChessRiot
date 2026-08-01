# ChessRiot

Play at [chessriot.gg](https://chessriot.gg), read the
[release history](https://chessriot.gg/changelog), or
[join the WhatsApp community](https://chat.whatsapp.com/FaBgiUgl73vLdeqzcqx0vX).

ChessRiot v0.17.0 is a mobile-first chess game for solo play against Riot Bot
or asynchronous play with someone you know. Guest play never requires an
account, CAPTCHA, or email address.

Use **Send feedback** in the unified Settings menu or
[open a GitHub issue](https://github.com/ripper234/ChessRiot/issues). See
[BACKLOG.md](BACKLOG.md) for deferred work and unresolved product decisions.

## What works

- Start Solo or Multiplayer chess from `/app`, choose one of five Riot Bot
  levels, and use Standard, three Mini Game, or three Solo Mating Set positions.
- Play complete server-authoritative chess with private seat links, durable D1
  state, immutable move history, deadlines, draw claims, promotion, castling,
  en passant, resignation, cancellation, and optimistic rendering.
- Choose one of 11 original skins before or during play. The skin changes the
  public shell, setup, menus, board, pieces, music, and visual effects before
  the game starts and stays synchronized across browser tabs.
- Use one Settings menu for appearance, separate music and sound-effect
  toggles, master volume, play assistance, notifications, surrender, feedback,
  install, privacy, community, and the unobtrusive version readout.
- Hear low-key skin-specific music and distinct sounds for movement, capture,
  check, castling, queen loss, promotion, and results. Reduced-motion and mute
  preferences are respected.
- See a roughly one-second, piece-specific capture sequence, a white-flag
  resignation finish, promotion effects, and small fork celebrations without
  delaying or blocking legal play.
- Keep the current position visible in a compact history row or expand the side
  panel for the complete move table. Captures carry a sword marker, and all
  captured pieces remain visible in their own side panel.
- Keep the default-on local Chess Coach enabled for obvious one-move material
  losses. It asks before submission and hides its short explanation until the
  player requests it. It does not use an LLM or alter chess legality.
- Send safe preset reactions, enable per-game closed-app turn notifications,
  install the PWA, and review the public changelog and privacy policy.
- Keep legacy stored Magic games playable while new Magic entry remains
  unavailable. Unsupported new Magic requests fail closed at the API boundary.
- Inspect isolated Development and Production health, activity, and feedback in
  the owner-only Control site.

## Current limits

No new Magic Rules, arbitrary executable rule prompts, LLM chess coach, email
notifications, free-form chat, friend graph, matchmaking, ratings, rewards,
account-bound cosmetic ownership, payments, or credit-priced Undo. Google
sign-in, cross-device account history, and multi-account switching remain
disabled until the OAuth implementation and external configuration are ready.

## Versioning and deployment

ChessRiot uses SemVer. Every changed deployment must have a new, higher version;
`npm run build` rejects reused or inconsistent versions. Use
`npm run release:patch`, `npm run release:minor`, or `npm run release:major`.

- Development receives each reviewed release after the complete gate passes.
- Production changes only after the owner explicitly promotes the approved
  Development release in Control.
- GitHub is canonical. A release is tied to an immutable commit and release
  branch or tag.
- Development and Production build the same immutable Git tree with
  target-local bindings. Data, secrets, and hostnames remain isolated.

See [docs/DEPLOYMENT_POLICY.md](docs/DEPLOYMENT_POLICY.md),
[docs/OPERATIONS.md](docs/OPERATIONS.md), and [SECURITY.md](SECURITY.md).

## Stack

Vinext/React, Cloudflare Workers, D1, R2, TypeScript, and chess.js.

## Local verification

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run build` is the release gate: lint, typecheck, unit tests, the production
artifact build and validation, rendered-output tests, and the Miniflare
end-to-end suite. CI runs the same gate, audits production dependencies, and
retains a CycloneDX SBOM. Contributor setup is in [CONTRIBUTING.md](CONTRIBUTING.md).
