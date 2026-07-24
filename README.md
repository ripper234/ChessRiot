# ChessRiot

ChessRiot v0.3.0 is a mobile-first chess game for solo play against Riot Bot or asynchronous play with someone you know.

## What works

- Enter a display name, then choose Solo or Multiplayer.
- Play Riot Bot at one of five difficulty levels, starting at Medium, as either color. If the bot is White, it opens automatically.
- Create a multiplayer game and share one private invitation link.
- Join from another browser or device without an account.
- Play complete standard chess with server-authoritative legal move validation.
- Persist the board, player names, result, and immutable move history in Cloudflare D1.
- Resume on any device using a private per-player game link whose key stays in the URL fragment.
- Detect check, checkmate, stalemate, castling, en passant, all four promotions, insufficient material, claimable threefold/50-move draws, and automatic fivefold/75-move draws.
- Use one original voxel/block-world identity with optional synthesized move, capture, check, and game-ending sounds.
- Drag and drop pieces with mouse or touch, while tap, click, and keyboard input still work. Short move and capture animations make accepted moves visible.
- Start from one compact new-game screen with no marketing detour.
- Open a newest-first public changelog from the home screen or any active game.
- Send a titled feedback item without leaving the current flow; each environment stores its own owner-review pool.
- Inspect privacy-safe, isolated health and activity data for all three environments in the owner control panel.

## Deliberate v0.3 limits

No AI coach, notifications, chat, matchmaking, ratings, rewards, themes, payments, accounts, or server-side account recovery. A private game link is a bearer credential: anyone who has it can play as that seat, so it must be kept private. A previously copied bare `/g/<id>` URL cannot recover a seat because it contains no credential.

## Versioning

ChessRiot uses SemVer. Every changed deployment gets a new, higher version and the build rejects an unchanged or inconsistent release number. Patch releases are the default; `0.y.0` marks a coherent new user capability. Version `1.0.0` means two people can create, join, securely resume, receive turn notifications, and finish asynchronous games without developer help.

Prepare releases with `npm run release:patch`, `npm run release:minor`, or `npm run release:major`. The version is updated in one place and displayed in the app footer.

## Stack

Vinext/React, Cloudflare Workers and D1, TypeScript, and chess.js. The former NextAuth/Prisma shell was removed because authentication and friends are outside this milestone.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
