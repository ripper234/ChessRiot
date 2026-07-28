# ChessRiot v0.14.0-capture.1 specification

## Capture-combat preview

- Physical attack animation is presentation-only. The server commits and
  validates the move before the client sequence begins, and animation never
  changes version, position, authorization, or move history.
- Each newly observed move is reconstructed from its immutable `fenBefore`.
  The live board temporarily shows that pre-move position while a
  pointer-transparent board overlay animates the attacker and, for a capture,
  keeps the victim visible until impact.
- Pawn, knight, bishop, rook, queen, and king captures use distinct, short
  actions. The tone is toy combat with no blood or realistic injury.
- En passant uses the captured pawn's real square. A capture-promotion attacks
  as a pawn and reveals the promoted piece afterward. Atomic Magic actions
  animate both legs in order.
- Board input remains locked for at most 720 milliseconds while an action is
  visible. Hiding the page, opening history, or enabling reduced motion clears
  the queue immediately.
- Reduced-motion players see the authoritative final board and a brief static
  capture marker without travel, rotation, particles, or an input delay.
- `/capture-lab` is branch-only and replays the exact production animation
  component for all six pieces. It must not be promoted as a stable route
  without an explicit product decision.

## v0.13.4 release additions

- Multiplayer invitations copy straight to the clipboard instead of opening
  the operating system share sheet.
- Successful copies are confirmed in place, and the private link remains
  selectable if clipboard access is unavailable.

## v0.13.3 release additions

- After a legal Solo move, the browser paints the human action and calculates
  Riot Bot's reply locally from the same evaluation, depth, node budget, and
  request-seeded random stream used by the server.
- The server independently reconstructs and validates both actions, then
  stores the human and bot plies in one conditional D1 batch. The successful
  response advances the authoritative game by two versions and requires no
  follow-up bot request or post-commit game reads.
- The preview never advances accepted server version or unlocks the next move.
  A rejection or transport failure reconciles against authoritative state.
  Authorized reads retain the leased pending-turn recovery path for older or
  interrupted games.
- Riot Bot search now uses its deterministic node budget as the sole cutoff so
  browser and Worker calculation cannot diverge because their clocks behave
  differently.

## v0.13.2 release additions

- Riot Bot search keeps its existing level-specific depth, move ordering, and
  evaluation while enforcing a deterministic node cap alongside the local
  elapsed-time budget.
- The deterministic cap bounds search even on an edge runtime whose clocks do
  not advance during CPU work. Default play remains roughly 0.2 seconds of
  search and Level 5 remains under one second in the frozen-clock regression.

## v0.13.1 release additions

- The public homepage links directly to the ChessRiot WhatsApp community.
- The App panel exposes the same community link without replacing or
  interrupting the active game.
- Both placements use one shared URL constant and open WhatsApp in a separate
  tab with safe external-link attributes.

## v0.13.0 release additions

- Each authorized multiplayer seat may opt the current browser into Web Push
  alerts for one specific game. Permission and subscription creation remain an
  explicit user action in the App panel.
- A subscription association is keyed by game, seat color, and a SHA-256
  endpoint identifier. Turning alerts off for one game does not unsubscribe the
  browser endpoint or disturb associations for other games.
- A successful, non-idempotent multiplayer move schedules best-effort delivery
  to the seat whose turn begins. Delivery failure cannot roll back, delay, or
  alter the committed move.
- Each subscription receives at most one `your_turn` delivery for a game
  version. Expired endpoints are removed, repeated failures are disabled, and
  delivery records expire after 30 days.
- Push endpoints are limited to known browser push services. Notification
  content is generic, contains no player names or private seat capabilities,
  and navigation is reconstructed only from a validated game UUID.
- `VAPID_PUBLIC_KEY`, secret `VAPID_PRIVATE_JWK`, and `VAPID_SUBJECT` must all
  be present for the feature to appear. Solo play and incomplete configuration
  fail closed.

## v0.11.0 release additions

- `/demo` presents a 90-second explainer assembled from current ChessRiot
  interface captures, with narration, burned-in English subtitles, a readable
  transcript, background audio, and an explicit AI-voice disclosure.
- The public homepage links to the demo without changing the existing primary
  play path.
- The bundled MP4 remains available whenever generated media is absent.
- Validated generated video and captions are published to R2 under immutable
  keys. A small manifest switches the current media only after upload succeeds,
  so video regeneration does not require or trigger a ChessRiot source deploy.
- Regeneration accepts a fixed script and fixed ChessRiot assets only. Signed
  requests, replay protection, one active job, a 30-minute cooldown, and
  daily/monthly limits bound its OpenAI narration usage.

## v0.10.2 release additions

- Refactored shared board presentation, game-creation payloads, status text, and
  client request helpers without changing gameplay or the Coming Soon boundary.
- Added regression coverage for both board orientations, outcome and live-status
  text, create payloads, and API error/header handling.

## v0.10.1 release additions

- Magic Rules remain visible in new-game setup, but the interior is a
  **Coming Soon** placeholder with no rule input or compilation action.
- The stable release contains no runtime LLM compiler endpoint or OpenAI call.
- Runtime Magic development continues on `feature/runtime-magic-rules` in an
  isolated preview lane. Existing stored Magic games remain readable for
  backwards compatibility.

## v0.9.3 release additions

- The new-game screen selects Solo on first load and immediately shows the
  Level 3 Riot Bot control. Multiplayer remains one explicit tap away.
- Standard chess still begins with White. A Solo game assigned to the human as
  Black commits Riot Bot's White opening before the game is returned.

## v0.9.2 release additions

- At ply zero, a staged first-leg Magic move keeps the Back arrow enabled.
  Using it cancels the draft and shows the authoritative starting position.

## v0.9.1 release additions

- Live-board history follows the exact position visible to the player, including
  the temporary optimistic Solo position. Back therefore never skips the last
  authoritative position.
- Back from a staged first leg of a Magic move cancels that draft and shows the
  latest authoritative position instead of skipping a ply.
- Historical squares remain readable but are removed from keyboard navigation.
- The status announcement contains status text only; navigation controls are a
  separate accessible group with 44-pixel touch targets.
- Move confirmation restores focus to its still-usable trigger after
  cancellation, or to the stable match status after a committed move or
  promotion.
- Move confirmation storage is described accurately as browser-local.

## v0.9.0 release additions

- Every game keeps Previous and Next position arrows visible beside the live
  match status. They reuse the main board, preserve the player's orientation,
  and never mutate the game.
- Historical viewing uses only committed server history. It remains pinned to
  the selected ply when polling adds a newer move, and Forward or Go Live
  returns to the current position.
- Historical boards derive their own last-move highlight, checked king, and
  captured pieces. Move effects, draw claims, and playable interactions remain
  live-only.
- Confirm every move is an opt-in, device-local setting under Move Settings.
  It is off by default.
- When enabled, one accessible confirmation appears before every human move
  submission, including tap, pointer drag, keyboard activation, promotion, and
  a completed one- or two-leg Magic turn. Bot moves and non-move actions do not
  prompt.
- A confirmation is valid only for the authoritative version on which it was
  opened. Position changes and duplicate confirmation clicks cannot submit a
  stale or second move.

## v0.8.2 release additions

- `/` is a fixed public homepage. It does not read hosting identity, local
  theme selection, or game data, so every visitor receives the same design.
- `/app` is the new-game entry point. A player enters a display name and can
  create Solo or Multiplayer games without a sign-in or CAPTCHA screen.
- Private seat links are the portable authority for guest play. Existing
  verified account memberships remain compatible, but no account is required
  for a newly created or joined game.
- Invitations can be reviewed before joining. Joining binds the supplied
  private seat token to one game color and never exposes it in the request URL
  or referrer.
- Visual themes load and render only on active `/g/*` game routes. Public,
  create, invitation, changelog, loading, and error pages keep one fixed style.
- The app-host routing boundary is ready: `/app` works now, and a future owned
  `app.<domain>` hostname may route its root directly to the same create flow.
- All user-facing sign-in prompts and retired CAPTCHA paths are absent from the
  packaged application.

## v0.8.1 release additions

- The separate human-check screen, Turnstile verification request, and
  CAPTCHA-bound application session are removed.
- A trusted Sites Sign in with ChatGPT identity is sufficient for playable
  APIs. Account ids remain HMAC-derived, game access remains membership-bound,
  and account rate limits remain enforced.
- Existing `/verify` entry points now send signed-in players directly to their
  requested safe in-app path. The retired CAPTCHA API returns no playable
  route.

## v0.8 release additions

- `Knights move twice.` is a supported deterministic Magic Rules clause for
  Solo and Multiplayer games.
- A knight's optional second leg must use the same knight. Like the existing
  rook rule, both legs commit atomically as one turn, version, history item,
  deadline action, and repetition position. A checking first leg ends the turn
  immediately.
- New knight-enabled rule documents use schema v2. Existing v1 games and
  idempotent retries for the original rule vocabulary remain valid and retain
  their original compiled document.
- The staged second-leg interaction is piece-neutral across tap, pointer drag,
  native keyboard activation, move history, replay, labels, and Riot Bot play.
- Same-origin mutation checks accept a Sites-sandboxed `Origin: null` only when
  the browser-controlled `Sec-Fetch-Site` value is `same-origin`. Explicit
  cross-origin values, opaque requests without that provenance, and
  `same-site`, `cross-site`, or `none` metadata remain rejected.

## v0.7 release additions

- The stable new-game screen shows Magic Rules as a Coming Soon placeholder and
  cannot create a new rule document.
- The prompt compiler accepts a short paragraph made from supported clauses,
  normalizes it, stores a versioned rule document, and rejects any clause it
  cannot interpret. Prompt text is never executed as code or copied into
  telemetry.
- The initial supported rules were: rooks may move twice in one turn, pawns
  cannot move onto the final rank, no castling, and no en passant.
- A rook's optional second move uses the same rook and commits atomically with
  the first move as one turn, version, history item, deadline action, and
  repetition position. If the first move gives check, the turn ends
  immediately.
- Magic Rules are visible before an invitation is claimed, throughout the live
  game, in move history and replay, and on My Games cards. Riot Bot and human
  players use the same rule-aware server adapter.

## v0.6 release additions

- My Games is an account-bound, newest-first history with cursor pagination.
  Cards show game mode, player color, waiting state, whose turn it is, and
  Won, Lost, or Draw outcomes.
- Optional open-app move alerts monitor every owned multiplayer game through
  the verified account session. They no longer depend on a legacy seat key or
  require the player to keep that specific game route open.
- Alert polling establishes a silent baseline, notifies only after a later
  opponent move, and remains excluded from product telemetry.
- The account menu exposes Switch Account through the trusted ChatGPT sign-out
  flow. ChessRiot does not store several identities in one browser session.

## v0.5 release additions

- Every player signs in with ChatGPT and completes a server-verified Turnstile
  challenge before creating, joining, reading, or mutating a game.
- A signed HttpOnly player session binds the trusted hosting identity to an
  opaque account id. D1 membership maps that account to exactly one game seat.
- Existing private seat links can claim their historical seat once after
  login. New account-bound games are resumable from the account game list
  without carrying a seat key between devices.
- Account-scoped write limits and a per-game/version Riot Bot lease bound
  automated abuse and duplicate computer searches. Volumetric protection
  remains an edge-hosting responsibility.
- When Riot Bot opens as White, a newly created Black-side game first paints
  the untouched starting position, then animates the committed White move once.
- The live board uses the available viewport on desktop and mobile. Secondary
  actions, replay, and history are collapsed behind one More control.
- Captured Black pieces appear with White, and captured White pieces appear
  with Black.
- Six original illustrated theme backgrounds are included, and Iron Legions
  plus Shadow Shogun expand the theme picker from nine to 11 choices.

## v0.4 release additions

- A textless palette control is available on every route and opens a
  keyboard-accessible picker with exactly nine original visual themes.
- Theme choices affect the page background, panels, board, captured pieces,
  and playable pieces. The choice persists locally, applies before paint, and
  synchronizes across open tabs.
- A small global version link is visible on home, join, loading, error, game,
  and changelog states.
- Active joined multiplayer games expose six safe preset cheers. For 15 minutes
  after completion, only Good Game and Thanks remain available; bounded history
  stays readable afterward. Cheers are authenticated, idempotent, rate-limited,
  and never allow free-form chat.
- Multiplayer creation offers one, three, or five days per move, defaulting to
  three. An expired turn ends the game with the side that missed its move as
  the loser. Legacy games without a stored pace keep no deadline.
- Every game exposes a read-only replay dialog with start, back, next, and end
  controls. Replay never mutates or replaces the live board.
- A live checkmate transition briefly animates the actual winning piece
  defeating the losing king. It does not replay after refresh and honors
  reduced-motion preferences.
- The app ships installable PWA metadata and a service worker that caches only
  public static assets. It never caches game, join, API, or credential-bearing
  responses.
- A subtle dot marks an unseen release. Players can opt into opponent-move
  notifications while ChessRiot remains open and unfocused; closed-app push is
  not claimed.
- Themes use CSS and one shared set of original flat SVG chess silhouettes.
  They do not use third-party logos, proprietary assets, or copied branded
  artwork.

## v0.3 release additions

- The home route is a compact start flow: display name, Solo or Multiplayer,
  conditional Solo bot level, and one primary action.
- Accepted moves receive a short destination animation; captures also receive a
  brief impact animation. Reduced-motion preferences disable both.
- In Solo, the client previews a locally legal human move and the deterministic
  Riot Bot reply while one request is in flight. The server independently
  validates and atomically stores both plies. Rejection or transport failure
  reconciles the preview against authoritative state.
- `/changelog` lists every release newest first with a short summary and GitHub
  source link, and is linked from the home and game interfaces.
- A visible Feedback button opens an in-place form with required title,
  optional comment, and an advanced GitHub contribution link.
- Feedback is stored per environment and is readable only through the signed,
  owner-facing operations endpoint. Feedback text is never copied into
  observability events.
- The game view fits the board to both viewport width and desktop viewport
  height, keeps player colors readable, lists lost pieces, and highlights the
  checked king.
- Active players can end by resignation, creators can cancel a waiting game,
  and New Game always creates a separate game without mutating prior history.

This file and `MVP.md` are the source of truth for the current milestone.

## v0.3.1 board and game controls

- The board fits common short laptop viewports at 100% browser zoom. The sidebar
  scrolls independently when necessary, and player, turn, and rules labels stay
  readable.
- White and Black are labeled explicitly for both seats. Captured pieces are
  reconstructed from immutable move history and grouped by the color that lost
  them.
- Check is shown in the status panel and directly on the checked king. An
  attempted move that does not answer check returns a specific explanation.
- New Game is always available. End Game requires confirmation and records a
  resignation; a waiting game can instead be cancelled, invalidating its
  invitation while preserving its history.
- User-facing Solo setup calls the five-step setting Bot level. Internal
  persistence continues to use `aiDifficulty`.

## Flow

1. The player opens the fixed public homepage and selects Play now, or opens
   `/app` directly.
2. The player enters a display name. Solo is selected by default; Multiplayer
   remains available without an account or human check.
3. The player sees Magic Rules as Coming Soon. New games use standard chess.
4. Solo reveals a five-step Bot level bar that starts at Level 3, Medium. Colors are assigned evenly and deterministically from the idempotent create request. If Riot Bot is White, its legal opening is committed before the game appears.
5. Multiplayer asks for a one, three, or five-day move pace, then opens White's reusable private game URL and shows a separate one-use invitation URL.
6. Black opens that invitation on another device, reviews any Magic Rules,
   enters a display name, and claims the second private seat.
7. Every human and computer move is revalidated by the server against authoritative history.
8. The board polls for changes and refreshes on focus. A player resumes from
   the recent-games list on that device or from the private seat link.

## Rules and persistence

- Standard chess is the only new-game option, implemented with chess.js.
  Previously stored games may carry an immutable legacy Magic document.
- D1 stores current FEN, status, version, mode, bot level, Magic prompt and
  compiled rules, players, hashed keys, and immutable ordered turn actions.
- Every move carries an expected version and idempotency key.
- A conditional update plus move insert runs atomically. Stale, illegal, wrong-turn, unauthorized, and completed-game moves do not mutate state.
- A two-step rook or knight action stores both legal legs in one move row and
  advances the turn, version, ply count, deadline, and repetition counter only
  once. The stored schema version determines the supported double-move pieces;
  v1 remains valid for existing rook games and v2 adds knights.
- In Solo, the browser and server calculate the same request-seeded Riot Bot
  choice with the shared bounded search. The server reconstructs authoritative
  history, validates the human action, independently calculates and validates
  the reply, then conditionally stores both move rows and the final game state
  in one atomic batch. The version and ply count advance by two. Every
  authenticated game read also retains the leased recovery path for a legacy
  pending bot turn, so an older or interrupted game cannot remain stranded.
- Replaying move history is required before validation so repetition remains correct.
- Promotion data is accepted only when a pawn reaches its final rank. Under the
  no-promotion rule, a pawn cannot move onto that rank at all.
- Threefold repetition and the fifty-move rule are player claims. Fivefold repetition and the seventy-five-move rule end automatically, after checkmate precedence.
- Before human or computer moves, immutable history must match current FEN, turn, and ply count.
- Ending a waiting game records cancellation with no winner. Ending an active
  game records resignation and the opponent as winner. Both actions are
  authenticated, version guarded, idempotent, and preserve move history.
- Joined multiplayer games derive each move deadline from the last accepted
  mutation. Reads, moves, draw claims, and resignations all enforce expiry
  atomically before accepting a later action.

## Identity and privacy

- Newly created guest games use 256-bit bearer secrets carried in a `#seat=`
  URL fragment. The server stores SHA-256 hashes only.
- A valid private seat token authorizes exactly one color. D1 membership keeps
  that authorization game-specific and prevents one identity from owning both
  seats.
- If Sites supplies a verified hosting identity, existing account membership
  remains a compatible authorization path. The interface never requires or
  advertises that identity.
- URL fragments are never sent in HTTP requests or referrers. Invitation links
  remain one-use, may be reviewed publicly, and require the correct invite
  token to claim.
- Guest and verified identities receive fixed-window application rate limits.
  Riot Bot work keeps its per-game/version lease. No CAPTCHA is used.

## Interface

- The public homepage, create flow, invitations, changelog, loading, and error
  states use one fixed visual system regardless of identity or stored theme.
- Eleven original visual themes cover active game panels, board, and pieces. The
  default Riot theme uses flat teal, slate, warm ivory, and gold. Six themes
  include generated, wholly original illustrations. Every theme keeps the same
  front-on 2D board structure and original vector piece silhouettes. None copy
  third-party game branding or assets.
- Drag and drop a piece, or tap/click a piece and then a legal destination.
- Board rotates for Black while submitted coordinates remain absolute chess squares.
- The interface shows explicit player colors, turn, check, the checked king,
  lost pieces, outcome, deadline, Magic Rules, move history, and read-only
  replay.
- When a threefold or fifty-move draw is available to the player on move, the interface offers an explicit claim.
- Synthesized move, capture, check, result, and invalid-action sounds are on by default and can be muted.
- Initial loads, refreshes, repeated polling responses, and join-only version changes do not replay move sounds.

## Observability

- Every important API action is recorded as a structured, privacy-safe event in that environment's isolated D1 database.
- Events carry environment, app version, request id, normalized route, result, latency, safe metadata, and an environment-local HMAC reference for the game.
- Unchanged three-second polls are excluded. Events are retained for 30 days with a hard cap.
- Never record player names, bearer keys, key hashes, invitation or private links, fragments, IP addresses, user agents, FENs, raw bodies, or arbitrary exception messages.
- Reaction events record only the selected preset key. Reaction reads are
  excluded from telemetry just like unchanged game polling.
- The owner-only control panel uses two-minute, environment-specific signed read grants and shows each environment separately. Failed reads remain visibly stale and never become fake zeroes.
