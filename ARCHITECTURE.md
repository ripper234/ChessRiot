# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/computer-player.ts`: bounded server-side move search for Riot Bot.
- `lib/computer-turn.ts`: recovery path for a pending Solo computer turn.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/ops-auth.ts`: short-lived signed observability-read grant verification.
- `lib/game-store.ts`: D1 reads and public snapshot shaping.
- `db/schema.ts` and `drizzle/`: durable game and move schema.
- `worker/index.ts`: Cloudflare Worker entry and runtime binding handoff.

The server is authoritative. The client submits only a move, expected version,
and idempotency key. Each mutation reconstructs the chess engine from immutable
history and validates FEN, turn, and ply invariants before the candidate. Every
human move atomically advances one ply and returns immediately. In Solo, the
client then requests the pending Riot Bot turn in the background. Every
authenticated game read runs the same pending-turn recovery, so refresh or
browser closure cannot strand the game. A White bot opening is committed during
create.

While the human request is in flight, the client renders a display-only legal
move preview without advancing the accepted server version or local
persistence. The one-ply authoritative response replaces it, then the bot reply
arrives as the next version. Rejection or transport failure reconciles the
preview against the server before rolling it back.

Player authority is game-scoped. The reusable private game URL carries the bearer key in its fragment, which is not sent to the server as part of the HTTP URL. After the key authenticates, the client caches it locally and sends it only in the authorization header. D1 stores only its hash.

In Multiplayer, the creator is White and the invitee is Black. In Solo, the
human may be White or Black. The unowned bot seat uses an unreachable stored
hash so only the human's private key authenticates.

Each environment stores its own observability events in its own D1. The Worker
wraps API requests, normalizes routes, skips unchanged polling, and uses
`waitUntil` for best-effort non-blocking persistence plus structured Worker
logs. The control Site mints two-minute HMAC grants; the owner's browser reads
each environment directly, so production, staging, and development data never
mix.
