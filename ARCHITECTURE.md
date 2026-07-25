# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/magic-rules.ts`: bounded prompt compiler and versioned per-game rule
  schema.
- `lib/computer-player.ts`: bounded server-side move search for Riot Bot.
- `lib/computer-turn.ts`: recovery path for a pending Solo computer turn.
- `lib/account-auth.ts`: trusted identity binding, signed player session, and server-side CAPTCHA verification.
- `lib/accounts.ts`: durable account summaries and account-scoped rate limits.
- `lib/game-auth.ts`: account membership authorization and legacy seat migration.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/ops-auth.ts`: short-lived signed observability-read grant verification.
- `lib/game-store.ts`: D1 reads and public snapshot shaping.
- `db/schema.ts` and `drizzle/`: durable game and move schema.
- `worker/index.ts`: Cloudflare Worker entry and runtime binding handoff.

The server is authoritative. The client submits a move, an optional same-rook
second leg, the expected version, and an idempotency key. Each mutation
reconstructs the chess engine from immutable history and validates FEN, turn,
and ply invariants before the candidate. Every completed human turn atomically
advances one ply and returns immediately. In Solo, the client then requests the
pending Riot Bot turn in the background. Every authenticated game read runs the
same pending-turn recovery, so refresh or browser closure cannot strand the
game. A White bot opening is committed during create.

Magic prompt text is normalized and compiled only through an explicit
allowlist. The immutable versioned result, not the prose, drives legality.
Unsupported clauses fail game creation. A valid two-step rook action is replayed
as two chess.js moves but stored and counted as one application turn, so no
partially committed variant state can become authoritative.

While the human request is in flight, the client renders a display-only legal
move preview without advancing the accepted server version or local
persistence. The one-ply authoritative response replaces it, then the bot reply
arrives as the next version. Rejection or transport failure reconciles the
preview against the server before rolling it back.

Player authority is account-scoped and game-specific. Sites supplies the trusted
Sign in with ChatGPT identity, Turnstile is verified by the Worker, and a
short-lived signed HttpOnly cookie binds those two checks. D1 membership rows
map an opaque HMAC account id to exactly one color per game.

Historical private game URLs still carry their bearer key in the fragment,
which is not sent as part of the HTTP URL. After a verified account presents a
valid legacy key, it may atomically claim that still-unbound seat. New and
migrated games can then be resumed from a bare game URL through account
membership alone.

In Multiplayer, the creator is White and the invitee is Black. In Solo, the
human may be White or Black. The unowned bot seat uses an unreachable stored
hash and never receives an account membership, so only the human account can
authorize the game.

Mutating routes enforce fixed-window account limits. Riot Bot work uses a
short per-game/version D1 lease, then revalidates the authoritative version
before searching or committing. These controls reduce application-resource
abuse and duplicate compute; the Sites/Cloudflare edge remains responsible for
volumetric network protection.

Concurrent game reads that encounter an existing bot lease wait for a bounded
fresh read instead of briefly returning the pre-bot version. They never acquire
a second lease or duplicate a move.

Each environment stores its own observability events in its own D1. The Worker
wraps API requests, normalizes routes, skips unchanged polling, and uses
`waitUntil` for best-effort non-blocking persistence plus structured Worker
logs. The control Site mints two-minute HMAC grants; the owner's browser reads
each environment directly, so production, staging, and development data never
mix.
