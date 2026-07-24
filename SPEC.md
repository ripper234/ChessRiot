# ChessRiot v0.2.0 specification

This file and `MVP.md` are the source of truth for the current milestone.

## Flow

1. The player enters a display name, then chooses Solo or Multiplayer.
2. Solo reveals a five-step difficulty bar that starts at 3, Medium. The game starts immediately with the player as White against Riot Bot.
3. Multiplayer opens White's reusable private game URL and shows a separate one-use invitation URL.
4. Black opens that invitation on another device, enters a display name, and claims the second seat.
5. Every human and computer move is revalidated by the server against authoritative history.
6. The board polls for changes and refreshes on focus. A player can open their private game URL on any device and restore the correct seat.

## Rules and persistence

- Standard chess only, implemented with chess.js.
- D1 stores current FEN, status, version, mode, computer difficulty, players, hashed keys, and immutable ordered moves.
- Every move carries an expected version and idempotency key.
- A conditional update plus move insert runs atomically. Stale, illegal, wrong-turn, unauthorized, and completed-game moves do not mutate state.
- In Solo, the human move and Riot Bot reply are committed in one atomic batch. Riot Bot uses bounded server-side search and always submits a move through the same chess.js rules adapter.
- Replaying move history is required before validation so repetition remains correct.

## Identity and privacy

- No account is required.
- Player keys are 256-bit bearer secrets carried in a `#seat=` URL fragment and cached per game in browser storage after successful authentication. The server stores SHA-256 hashes only.
- URL fragments are never sent in HTTP requests or referrers. A private game URL is still a bearer credential, so anyone who has it can play as that seat.
- Existing same-browser games add the cached key to the URL after authentication so their next copied link is portable. A bare game URL on a new device remains unauthorized.
- Invitation links are one-use. A third party cannot read a game without one of its player keys.

## Interface

- One original voxel/block-world identity using grass, dirt, stone, wood, sand, water, and torch-light colors. It does not copy third-party game branding or assets.
- Drag and drop a piece, or tap/click a piece and then a legal destination.
- Board rotates for Black while submitted coordinates remain absolute chess squares.
- The interface shows turn, check, outcome, players, and move history.
- Synthesized move, capture, check, result, and invalid-action sounds are on by default and can be muted.
- Initial loads, refreshes, repeated polling responses, and join-only version changes do not replay move sounds.
