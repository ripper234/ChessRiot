# ChessRiot v0.1.x specification

This file and `MVP.md` are the source of truth for the current milestone.

## Flow

1. White enters a display name and creates a game.
2. The app stores White's private per-game key locally and shows a one-use invitation URL.
3. Black opens that URL on another device, enters a display name, and claims the second seat.
4. Both players make legal moves in turn. The server revalidates every move against authoritative history.
5. The board polls for changes and refreshes on focus. Closing and reopening the same browser restores the seat and game.

## Rules and persistence

- Standard chess only, implemented with chess.js.
- D1 stores current FEN, status, version, players, hashed keys, and immutable ordered moves.
- Every move carries an expected version and idempotency key.
- A conditional update plus move insert runs atomically. Stale, illegal, wrong-turn, unauthorized, and completed-game moves do not mutate state.
- Replaying move history is required before validation so repetition remains correct.

## Identity and privacy

- No account is required.
- Player keys are 256-bit bearer secrets stored per game in browser storage. The server stores SHA-256 hashes only.
- Invitation links are one-use. A third party cannot read a game without one of its player keys.

## Interface

- One original neon arcade identity using the ChessRiot navy, cyan, gold, purple, pink, and teal brand system.
- Tap a piece, then a legal destination.
- Board rotates for Black while submitted coordinates remain absolute chess squares.
- The interface shows turn, check, outcome, players, and move history.
- Synthesized move, capture, check, result, and invalid-action sounds are on by default and can be muted.
- Initial loads, refreshes, repeated polling responses, and join-only version changes do not replay move sounds.
