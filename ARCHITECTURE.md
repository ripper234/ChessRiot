# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/magic-rules-interpreter.ts`: server-only OpenAI Responses boundary with
  strict structured output.
- `lib/magic-rules.ts`: local validation and the versioned deterministic
  per-game rule schema.
- `lib/computer-player.ts`: bounded server-side move search for Riot Bot.
- `lib/computer-turn.ts`: recovery path for a pending Solo computer turn.
- `lib/account-auth.ts`: trusted hosting identity and stable guest-id derivation.
- `lib/accounts.ts`: durable identity summaries and identity-scoped rate limits.
- `lib/game-auth.ts`: hybrid account-membership and private-seat authorization.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/ops-auth.ts`: short-lived signed observability-read grant verification.
- `lib/game-store.ts`: D1 reads and public snapshot shaping.
- `db/schema.ts` and `drizzle/`: durable game and move schema.
- `worker/index.ts`: Cloudflare Worker entry and runtime binding handoff.

The server is authoritative. The client submits a move, a bounded optional
continuation by the same Magic-enabled piece, the expected version, and an
idempotency key. Each mutation
reconstructs the chess engine from immutable history and validates FEN, turn,
and ply invariants before the candidate. Every completed human turn atomically
advances one ply and returns immediately. In Solo, the client then requests the
pending Riot Bot turn in the background. Every authorized game read runs the
same pending-turn recovery, so refresh or browser closure cannot strand the
game. A White bot opening is committed during create.

Magic prompt text is normalized and sent to a server-only runtime interpreter.
The model must return a strict structured document from ChessRiot's bounded
rule vocabulary. Local validation is authoritative, and a short-lived HMAC
token binds the prompt and document to the requesting guest account before
creation. The immutable versioned result, not the prose or a later model call,
drives legality. Unsupported or ambiguous requests fail before game creation.
A valid same-piece sequence is replayed as multiple chess.js moves but stored
and counted as one application turn, so no partially committed variant state
can become authoritative. Original v1 and v2 documents remain readable;
v3 stores generic move limits and continuation arrays without changing older
games.

Mutation provenance uses the exact URL origin plus browser-controlled
`Sec-Fetch-Site`. A Sites-sandboxed opaque `Origin: null` is accepted only with
`Sec-Fetch-Site: same-origin`; cross-site metadata and unverifiable opaque
origins fail closed.

While the human request is in flight, the client renders a display-only legal
move preview without advancing the accepted server version or local
persistence. The one-ply authoritative response replaces it, then the bot reply
arrives as the next version. Rejection or transport failure reconciles the
preview against the server before rolling it back.

Player authority is identity-scoped and game-specific. New guest games derive
a stable opaque guest id from a browser-local identity secret that is distinct
from every private seat secret. Existing Sites identity headers remain
supported, but the UI does not require them. D1 membership rows map either
identity type to exactly one color per game. Identity-scoped limits remain
active without a separate human-check gate.

Private game URLs carry their bearer key in the fragment, which is not sent as
part of the HTTP URL. A valid token authorizes only its matching color. When a
seat already has an account membership, the same valid token acts through that
existing membership so v0.8.1 games remain playable without a sign-in prompt.

In Multiplayer, the creator is White and the invitee is Black. In Solo, the
human may be White or Black. The unowned bot seat uses an unreachable stored
hash and never receives a membership, so only the human player can
authorize the game.

Mutating routes enforce fixed-window identity limits. Riot Bot work uses a
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
