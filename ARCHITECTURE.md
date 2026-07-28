# Architecture

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/magic-rules.ts`: legacy deterministic rule documents retained only so
  previously created Magic games remain readable.
- `lib/computer-player.ts`: deterministic bounded move search shared by the
  Solo browser preview and authoritative server.
- `lib/computer-turn.ts`: leased recovery path for a legacy pending Solo turn.
- `lib/account-auth.ts`: trusted hosting identity and stable guest-id derivation.
- `lib/accounts.ts`: durable identity summaries and identity-scoped rate limits.
- `lib/game-auth.ts`: hybrid account-membership and private-seat authorization.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/push-notifications.ts`: per-game subscription storage, Web Push request
  construction, duplicate suppression, and best-effort delivery.
- `lib/push-client.ts`: browser subscription serialization and endpoint hashing.
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

The server is authoritative. The client submits a move, an optional second leg
by the same Magic-enabled rook or knight, the expected version, and an
idempotency key. Each mutation reconstructs the chess engine from immutable
history and validates FEN, turn, and ply invariants before the candidate. A
Multiplayer request advances one ply. A Solo request also calculates and
validates Riot Bot's deterministic reply, then conditionally stores both move
rows and the final game state in one D1 batch. A successful Solo response is
shaped from that committed result without additional game or move reads. Every
authorized game read retains the leased pending-turn recovery path for legacy
or interrupted states. A White bot opening is committed during create.

Stable new-game setup contains no Magic prompt, compiler action, runtime LLM
endpoint, or model call. Legacy immutable Magic documents remain supported for
previously created games so their history does not break. New runtime Magic
work lives on `feature/runtime-magic-rules` and must return through an isolated
preview and explicit merge.

Closed-app turn alerts are opt-in and game-specific. The browser holds one
origin-level PushSubscription, while D1 associates its endpoint hash separately
with each authorized game and seat. Disabling one association never calls the
browser-wide `unsubscribe()` operation. After a successful multiplayer move,
the Worker clones the response and schedules delivery with `waitUntil`; it
queries only the new turn’s game and color, claims a unique
subscription/game/version delivery row, and sends a generic encrypted payload.
Known browser push-service origins, strict key bounds, validated UUID
navigation, stale-endpoint deletion, and a failure circuit breaker contain the
external delivery boundary. The move remains authoritative regardless of every
notification outcome.

Mutation provenance uses the exact URL origin plus browser-controlled
`Sec-Fetch-Site`. A Sites-sandboxed opaque `Origin: null` is accepted only with
`Sec-Fetch-Site: same-origin`; cross-site metadata and unverifiable opaque
origins fail closed.

While a Solo request is in flight, the client first renders the legal human
move, then runs the shared request-seeded Riot Bot search and renders its reply.
This display-only preview does not advance the accepted server version, write
local persistence, or unlock another move. The authoritative two-ply response
must match because the server independently repeats the same deterministic
search. Rejection or transport failure reconciles the preview against the
server before rolling it back.

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

Mutating routes enforce fixed-window identity limits. Normal Solo replies are
covered by the human move's authorization, idempotency key, version guard, and
single conditional batch. Pending-turn recovery uses a short per-game/version
D1 lease, then revalidates the authoritative version before searching or
committing. These controls reduce application-resource abuse and duplicate
compute; the Sites/Cloudflare edge remains responsible for volumetric network
protection.

Concurrent game reads that encounter an existing bot lease wait for a bounded
fresh read instead of briefly returning the pre-bot version. They never acquire
a second lease or duplicate a move.

Riot Bot keeps the same level-specific search depth, ordered alpha-beta search,
evaluation function, and deterministic node budget. The node budget is the sole
cutoff because Cloudflare Workers freeze elapsed-time clocks during CPU-only
work while browsers do not. Request-seeded random choices and a clock-free
search make the browser preview and server result identical without weakening
the bot.

Each environment stores its own observability events in its own D1. The Worker
wraps API requests, normalizes routes, skips unchanged polling, and uses
`waitUntil` for best-effort non-blocking persistence plus structured Worker
logs. The control Site mints two-minute HMAC grants; the owner's browser reads
each environment directly, so production, staging, and development data never
mix.
