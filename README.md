# ChessRiot

ChessRiot v0.2.0 is a mobile-first chess game for solo play against Riot Bot or asynchronous play with someone you know.

## What works

- Enter a display name, then choose Solo or Multiplayer.
- Play Riot Bot at one of five difficulty levels, starting at Medium.
- Create a multiplayer game and share one private invitation link.
- Join from another browser or device without an account.
- Play complete standard chess with server-authoritative legal move validation.
- Persist the board, player names, result, and immutable move history in Cloudflare D1.
- Resume on any device using a private per-player game link whose key stays in the URL fragment.
- Detect check, checkmate, stalemate, castling, en passant, all four promotions, repetition, insufficient material, and the fifty-move rule.
- Use one original voxel/block-world identity with optional synthesized move, capture, check, and game-ending sounds.
- Drag and drop pieces with mouse or touch, while tap, click, and keyboard input still work.

## Deliberate v0.2 limits

No AI coach, notifications, chat, matchmaking, ratings, rewards, themes, payments, accounts, or server-side account recovery. A private game link is a bearer credential: anyone who has it can play as that seat, so it must be kept private. A previously copied bare `/g/<id>` URL cannot recover a seat because it contains no credential.

## Versioning

ChessRiot uses SemVer. While the product is pre-1.0, `0.1.x` is for rapid fixes and polish, and `0.y.0` marks a coherent new user capability. Version `1.0.0` means two people can create, join, securely resume, receive turn notifications, and finish asynchronous games without developer help.

## Stack

Vinext/React, Cloudflare Workers and D1, TypeScript, and chess.js. The former NextAuth/Prisma shell was removed because authentication and friends are outside this milestone.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
