# Architecture

## Magic Worlds and credits

- `lib/magic-world-code.ts` upgrades every supported Magic rules version into a
  sorted semantic document. SHA-256 of that document is the immutable World
  identity; a 160-bit prefix is displayed and the full digest detects a prefix
  collision.
- `/api/worlds/apply` is the only compilation and debit boundary. One request
  may resolve an exact-prompt cache hit, create a new canonical World, or
  rediscover an existing World. It emits one entitlement keyed by the exact
  future game-create request ID. The fingerprint-bound credit reservation is
  committed before any provider call; compiler leases collapse concurrent
  identical inputs, and an unfinished browser request is retained for safe
  idempotent retry. Exact pending-debit retries bypass fresh-Apply quotas so a
  retry can never be rate-limited away from its reserved credit. The
  authenticated recovery route restores completed, unconsumed reservations.
- `/api/games` accepts only an applied `worldCode`, snapshots canonical rules,
  and consumes the same entitlement. The LLM is never called from game
  creation, gameplay, replay, map browsing, or joining.
- `account_credit_ledger` is append-only and source-key idempotent. Starter,
  referral, debit, refund, and royalty reasons share one balance. A new account
  receives 10, Apply costs 1, referrals award 10, and a creator earns 1 per 5
  qualifying games by other accounts.
- World derivations are immutable parent-to-child edges. Cycle insertion is
  rejected with a recursive reachability query, and a real fork's edge must
  exist before its source or entitlement can be inserted. Popularity begins only after a
  human move; royalties also require the paying account to make a legal move.
- The private exact-input cache stores a normalized-input hash and compiled
  rules, never the raw prompt. World, map, invitation, game, recap, telemetry,
  and ledger records contain only canonical rules, hashes, labels, or public
  World codes.

- `app/`: Vinext pages, client interactions, and HTTP APIs.
- `lib/game-rules.ts`: pure chess.js adapter and terminal-state logic.
- `lib/game-variants.ts`: immutable, allowlisted starting-position presets and
  their public Mini Game labels.
- `lib/magic-rules.ts`: legacy deterministic rule documents retained only so
  previously created Magic games remain readable.
- `lib/computer-player.ts`: deterministic bounded move search shared by the
  Solo browser preview and authoritative server.
- `lib/computer-turn.ts`: leased recovery path for a legacy pending Solo turn.
- `lib/account-auth.ts`: compatible identity helpers and stable legacy guest-id
  derivation.
- `lib/google-auth.ts`: canonical-host OAuth start, PKCE transaction state,
  Google OpenID token verification, pseudonymous account derivation, and signed
  ChessRiot sessions.
- `lib/accounts.ts`: durable identity summaries and identity-scoped rate limits.
- `lib/game-auth.ts`: Google-session, account-membership, and exact legacy-seat
  authorization.
- `lib/observability.ts`: central request observation, safe event storage, correlation, and retention.
- `lib/push-notifications.ts`: account-device and legacy game-scoped Web Push
  storage, request construction, duplicate suppression, delivery retries, and
  bounded Control service-message sends.
- `lib/push-client.ts`: browser subscription serialization and endpoint hashing.
- `lib/ops-auth.ts`: short-lived, scope-specific Control grant verification,
  including dedicated LLM smoke and player-notification scopes.
- `lib/feature-access.ts`: allowlisted feature-access request state, bounded
  queue reads, and atomic approve or dismiss transitions.
- `lib/demo-video.ts`: fixed narration, signed generation requests, bounded
  job state, and atomic generated-media manifest handling.
- `lib/openai-smoke.ts`: fixed, bounded Responses API health check selected by
  the active environment only.
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

Ordinary new-game setup cannot apply Magic. It may create one durable request
for the allowlisted feature. Control lists that environment's queue with a
dedicated signed scope; approving an opaque request id enables the same
server-side account flag checked by Apply and game creation and removes the
request in one D1 batch. Enabled accounts receive the bounded World flow above.
Legacy immutable Magic documents remain supported so their history does not
break.

Mini Games are starting-position presets, not arbitrary rule code. The browser
sends an allowlisted variant id, the server selects its immutable FEN, and
`game_settings.variant_id` preserves the semantic label while
`games.initial_fen` remains the replay authority. Standard is the durable
legacy default. Mini Games use normal chess terminal rules and cannot combine
with Magic Rules in v0.14.0.

Closed-app notifications are explicit and account-device scoped. The browser
holds one origin-level PushSubscription; D1 assigns its endpoint hash to one
current account and no more than six active devices per account. An enabled
device covers existing and future multiplayer memberships. Old game/seat rows
remain narrow until that browser explicitly opts into the new account scope;
the upgrade then removes matching legacy endpoint rows to prevent duplicates.
After a successful multiplayer move, the same D1 batch inserts one unique
device/game/version intent for the player receiving the turn. The Worker leases
due account and legacy rows, rechecks membership, game version and turn, and
sends generic encrypted payloads with bounded retries. A qualifying fetch starts
an immediate one-row batch per independent lane, continues healthy due backlog
while a 25-second safety budget retains room for another provider call, and
retries failed lanes after about 2.1 and 17.2 seconds when that budget permits.
An exception in one lane cannot cancel the other. Later due rows resume on
subsequent non-health API traffic. Due failed rows sort ahead of fresh pending
rows so the bounded rounds target recovery rather than newer backlog. Exhausted
or aged rows become terminal on the next drain, and provider-stale targets are
soft-disabled until their 30-day delivery audit rows expire. Provider success
cannot revive a concurrently stale target, registration checks stale credentials
inside the atomic upsert, and active-target caps soft-disable parents instead of
cascading away queued or audited deliveries.
The Worker retains a scheduled handler for a future compatible host, but Sites
deployments do not rely on it. Known browser push
origins, key bounds, exact-game navigation, stale-endpoint disablement, sign-out
detachment, a browser-local account owner marker, service-worker consent cache,
subscription-rotation and page-open repair, focused version-conditional
notification clearing, snapshot-conditional delivery updates, and global
endpoint ownership contain the external boundary. The move remains
authoritative regardless of notification outcome.

Control custom sends are a distinct service-message boundary. Control verifies
the owner and same-origin request, signs the exact environment, username, action
and body into a short-lived grant, and the game consumes its nonce in D1 before
any outbound request. Only a fixed title, `/app` destination, single-line
120-character body, exact target, device cap, and hourly budgets are accepted.
The first terminal result is stored with the nonce, so an exact retry after a
lost response returns the same aggregate without sending again. Neither
response nor logs expose subscription material or message content.

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

Player authority is identity-scoped and game-specific. A valid Google session
is required for all play. Exact private-seat capabilities select a seat but do
not replace account authentication. Google login derives a pseudonymous durable
account from the verified provider subject and never uses email as its key.
Signed-in creates and joins write that account membership so games follow the
player across devices. D1 membership rows map an identity to exactly one color
per game. Identity-scoped limits remain active without a separate human-check
gate.

Private game URLs carry their bearer key in the fragment, which is not sent as
part of the HTTP URL. A valid token identifies its matching offered seat; the
signed-in account must claim or already own that seat before play. Ordinary
game loads never silently change ownership.

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
each environment directly, so Production and Development data never mix.
Game reads and Google session reads add bounded stage durations to their existing
request event metadata and to the `Server-Timing` response header. Game stages
include schema readiness, authorization, deadline resolution, move retrieval,
and snapshot building. Session stages include cookie verification, schema
readiness, account upsert, profile, and feature access. Timings contain only
fixed stage names and whole milliseconds. Unchanged game polls retain their
`Server-Timing` header but create no observability event.
