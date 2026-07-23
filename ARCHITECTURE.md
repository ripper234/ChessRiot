# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/game-store.ts`: D1 reads and public snapshot shaping.
- `db/schema.ts` and `drizzle/`: durable game and move schema.
- `worker/index.ts`: Cloudflare Worker entry and runtime binding handoff.

The server is authoritative. The client submits only a move, expected version, and idempotency key. Each mutation reconstructs the chess engine from immutable history, validates the candidate, then atomically advances the version and appends the move.

Player authority is game-scoped. The client sends a bearer key; D1 stores only its hash. The creator is White and the invitee is Black in v0.1.
