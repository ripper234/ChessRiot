# ChessRiot

Play at [chessriot.gg](https://chessriot.gg), read the
[release history](https://chessriot.gg/changelog), or
[join the WhatsApp community](https://chat.whatsapp.com/FaBgiUgl73vLdeqzcqx0vX).

ChessRiot v0.30.1 is a mobile-first chess game for solo play against Riot Bot
or asynchronous play with someone you know. Playing requires a Google account;
every game, friend, and result follows the player across devices.

The v0.27.7 release makes game entry recoverable when a response body stalls,
delivers the creator's first-turn push exactly once after acceptance, and keeps
Activity plus Android notification repair visible on every signed-in route.
Protected game, invitation, Activity, and Settings states now render native
Hebrew before first paint without reversing boards, notation, codes, or clocks.

Use **Send feedback** in the unified Settings menu or
[open a GitHub issue](https://github.com/ripper234/ChessRiot/issues). See
[BACKLOG.md](BACKLOG.md) for deferred work and unresolved product decisions.

## What works

- Sign in with Google and claim one permanent, globally unique username. New
  usernames use 3–20 characters, begin with a letter from any writing system,
  continue with international letters or numbers plus internal dots, hyphens,
  or underscores, and pass reserved-name and profanity checks.
- Land on a signed-in dashboard with current games, automatic complete game
  history, incoming and outgoing friend requests, and friend challenges with
  clear accept or decline controls.
- Start an optional, skippable 30–60 second interaction tutorial from Settings.
  It is never shown automatically, including for a new account.
- Use one Activity inbox for unread friend requests, challenges, turns, and
  results, with direct actions and durable read state across devices.
- Cancel outgoing requests, remove friends, block or unblock players, and send
  bounded category-based safety reports without exposing report details to
  other players. Control exposes a separately authorized moderation queue;
  deletion-related report copies expire after 90 days.
- Find another registered player by exact username, become friends, then send
  a configured challenge or create a private invitation. The UI states that the
  game waits for acceptance and offers accept or decline in the game view.
- Start Solo or Multiplayer chess from `/app`, choose one of five Riot Bot
  levels, and use Standard, three Mini Game, or three Solo Mating Set positions.
- Invited Magic testers can apply an empty-by-default natural-language rule for
  one credit, reuse or fork canonical Worlds, browse their directed lineage,
  and play with World details kept in the game sidebar rather than above the
  board. Every account starts with 10 credits. Compiler failures distinguish
  rule guidance, connectivity, service, and configuration problems while hard
  budgets, output limits, semantic rejection caching, and a circuit breaker
  prevent unbounded refunded token spend.
- Play complete server-authoritative chess with durable D1 state, immutable move
  history, one-, three-, or five-day deadlines, draw claims, promotion,
  castling, en passant, resignation, and cancellation. Day-based games show the
  move deadline instead of a separate live chess clock.
- Recover safely from temporary session or game-read failures with bounded,
  coalesced retries and immediate reconnect/focus checks. Moves and other game
  mutations are never submitted automatically a second time.
- Choose one of 12 original skins, including Mythic Beasts, before or during
  play. The skin changes the public shell, setup, menus, board, pieces, music,
  and visual effects before the game starts and stays synchronized across
  browser tabs.
- Use one icon-led Settings menu with checkboxes for on/off preferences and
  separate volume sliders for sound effects and music.
- Hear a richer, compositionally distinct score for every skin plus themed
  sounds for movement, capture, check, castling, queen loss, promotion, and
  results. Reduced-motion and mute preferences are respected.
- See a roughly one-second, piece-specific capture sequence, a white-flag
  resignation finish, clearer legal targets, exact homepage demo movement,
  improved promotion and postgame effects, and small fork celebrations without
  delaying or blocking legal play.
- Keep the active board, player status, deadline, and primary controls within a
  one-screen desktop game layout at standard browser zoom.
- Keep the current position visible in a compact history row or expand the side
  panel for the complete move table. Captures carry a sword marker, and all
  captured pieces remain visible in their own side panel.
- After a completed game, create a revocable public recap link with a read-only
  board, move-by-move replay, result, variant, and player usernames. The link
  never exposes seat keys, invite credentials, account IDs, or game mutation.
- Keep the default-on local Chess Coach enabled for obvious one-move material
  losses. It asks before submission and hides its short explanation until the
  player requests it. It does not use an LLM or alter chess legality.
- See one optional notification offer per retained browser/device profile
  during signed-in entry. **Enable notifications** opens the browser request;
  **Not now** and every setup failure continue directly to play without an
  automatic repeat. Allowing covers current and future multiplayer games,
  Settings provides manual recovery and a stage-specific exact-device test,
  and legacy game-only consent remains visible and narrow until it is
  explicitly changed. Install the PWA and review the public changelog. Privacy
  and Terms are linked
  subtly from the registration flow rather than the public homepage.
- Navigate with a keyboard skip link, visible focus, stronger contrast and
  forced-colors support, 44-pixel coarse-pointer targets, and reduced motion.
  Save-Data and very slow connections reduce nonessential polling and visual
  cost while preserving explicit actions and authoritative game state.
- Download a readable account-data export, manage blocked players, or
  permanently delete an account after recent Google verification. Deleted
  usernames stay reserved and surviving game records are anonymized.
- Request a Magic Rules invitation directly from its locked setup card. The
  request remains visibly pending until the owner approves or dismisses it;
  only approved accounts may create supported, deterministically compiled
  rules, and unsupported requests fail closed.
- Inspect isolated Development and Production health, activity, and feedback in
  the owner-only Control site, including Magic whitelist management and a
  red-badged access-request queue, exact-player notification tests, and a
  privacy-safe first-party launch Analytics center with separate automated
  signup-to-first-move journey cards.
- Keep the unlisted 90-second demo route and bounded owner regeneration system
  available for a future replacement without advertising the current video.

## Current limits

No arbitrary executable Magic code, LLM chess coach, email notifications,
free-form chat, matchmaking, ratings, rewards, account-bound cosmetic
ownership, payments, or credit-priced Undo. Multi-account switching and
username changes remain unavailable. Guest play is not supported.
The Sites runtime does not currently provide ChessRiot with a verified recurring
push trigger. A delivery still pending after the bounded request-time retries is
retried by a later non-health API request. Autonomous later recovery remains
tracked in [GitHub issue #61](https://github.com/ripper234/ChessRiot/issues/61).

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

`npm run build` is the release gate: production dependency security audit, lint, typecheck, unit tests, the production
artifact build and validation, rendered-output tests, and the Miniflare
end-to-end suite. CI runs the same gate, audits production dependencies, and
retains a CycloneDX SBOM. Contributor setup is in [CONTRIBUTING.md](CONTRIBUTING.md).

The suite contains exactly one opt-in live LLM test. It is skipped during
ordinary builds to prevent accidental spend. Operators can run it once against
an explicitly selected target with `RUN_OPENAI_LIVE_TEST=1` and
`OPENAI_LIVE_TARGET=development` or `production`. The selected process must
contain only the matching suffixed key.
