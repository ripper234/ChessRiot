# ChessRiot

ChessRiot v0.1.1 is a mobile-first, asynchronous chess game for two people who already know each other.

## What works

- Create a game with a display name and share one private invitation link.
- Join from another browser or device without an account.
- Play complete standard chess with server-authoritative legal move validation.
- Persist the board, player names, result, and immutable move history in Cloudflare D1.
- Resume on the same browser using a per-game private player key.
- Detect check, checkmate, stalemate, castling, en passant, all four promotions, repetition, insufficient material, and the fifty-move rule.
- Use a single neon arcade identity with optional synthesized move, capture, check, and game-ending sounds.

## Deliberate v0.1 limits

No AI opponent, notifications, chat, matchmaking, ratings, rewards, themes, payments, or account recovery. If a browser's private player key is cleared, that seat cannot currently be recovered.

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
