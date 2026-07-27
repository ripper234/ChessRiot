# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/magic-rules.ts`: exact validation, canonicalization, labels, and
  backwards-compatible parsing for immutable Magic rule documents.
- `lib/magic-rules-interpreter.ts`: one bounded natural-language-to-v3 model
  boundary used only during game creation.
- `lib/magic-rules-compiler.ts`: normalized, compiler-versioned D1 cache with a
  short compilation lease; failures are never cached.
- `lib/computer-player.ts`: bounded server-side move search for Riot Bot.
- `lib/computer-turn.ts`: recovery path for a pending Solo computer turn.
- `lib/account-auth.ts`: trusted hosting identity and stable guest-id derivation.
- `lib/accounts.ts`: durable identity summaries and identity-scoped rate limits.
- `lib/game-auth.ts`: hybrid account-membership and private-seat authorization.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/ops-auth.ts`: short-lived signed observability-read grant verification.
- `lib/demo-video.ts`: fixed narration, signed generation requests, bounded
  job state, and atomic generated-media manifest handling.
- `lib/game-store.ts`: D1 reads and public snapshot shaping.
- `db/schema.ts` and `drizzle/`: durable game and move schema.
- `worker/index.ts`: Cloudflare Worker entry and runtime binding handoff.

The `/demo` page always has a bundled 90-second MP4 and VTT fallback. Generated
media is stored under immutable R2 keys, then activated by replacing
`demo-video/latest.json` only after the video and captions are both present.
That manifest-last publish keeps the prior video live on any failure and makes
later regeneration independent of application deployment.

Control is the only browser surface that can start regeneration. Its Worker
requires the exact owner identity and same-origin Fetch Metadata, then signs a
fixed narration or publish request with a shared HMAC secret. The game Worker
validates a short timestamp, single-use nonce, job state, duration, MIME type,
and byte limits. One active job, a 30-minute cooldown, and daily/monthly request
caps bound narration spend. Neither side accepts a caller-provided script,
asset URL, model, or voice.

The server is authoritative. The client submits a move, zero or more
continuation legs by the same Magic-enabled physical piece, the expected
version, and an idempotency key. Each mutation
reconstructs the chess engine from immutable history and validates FEN, turn,
and ply invariants before the candidate. Every completed human turn atomically
advances one ply and returns immediately. In Solo, the client then requests the
pending Riot Bot turn in the background. Every authorized game read runs the
same pending-turn recovery, so refresh or browser closure cannot strand the
game. A White bot opening is committed during create.

On this feature branch, game creation accepts an optional Magic prompt. The
server normalizes it and first resolves an already-completed idempotent create.
Before rate limiting, cache access, or compilation, it reserves the request id
under a fingerprint of every canonical create field. A matching active lease
returns a retryable response, a different fingerprint conflicts, and only an
expired matching lease may be reclaimed. The final game writes are fenced to
the current unexpired owner and remove the intent in the same D1 batch.

The compiler reads a second D1 cache keyed by the normalized prompt plus
compiler version. A cache miss acquires a short lease and makes one bounded
model request; only a strict, fully supported v3 document is stored. Concurrent
non-owners retry, corrupt cache entries are discarded, and unsupported,
ambiguous, provider, and validation failures are never cached. There is no
standalone preview endpoint, and move, replay, bot, and recovery paths never
call the interpreter.

The deterministic engine fixes the eligible piece type and maximum sequence
length at the start of the turn, then requires every continuation leg to use
the same physical piece. A player may stop early after any legal leg. Giving
check ends the turn immediately. All legs share one atomic ply, version,
deadline update, and repetition position, including when a pawn promotes.
Legacy immutable v1 and v2 documents remain readable.

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
