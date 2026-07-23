# ChessRiot

ChessRiot v0.1 is a mobile-first, asynchronous chess game for two people who already know each other.

## What works

- Create a game with a display name and share one private invitation link.
- Join from another browser or device without an account.
- Play complete standard chess with server-authoritative legal move validation.
- Persist the board, player names, result, and immutable move history in Cloudflare D1.
- Resume on the same browser using a per-game private player key.
- Detect check, checkmate, stalemate, castling, en passant, all four promotions, repetition, insufficient material, and the fifty-move rule.

## Deliberate v0.1 limits

No AI opponent, notifications, chat, matchmaking, ratings, rewards, themes, payments, or account recovery. If a browser's private player key is cleared, that seat cannot currently be recovered.

## Stack

Vinext/React, Cloudflare Workers and D1, TypeScript, and chess.js. The former NextAuth/Prisma shell was removed because authentication and friends are outside this milestone.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
