# ChessRiot v0.4.0 specification

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
- Themes use CSS and existing chess glyphs only. They do not use third-party
  logos, proprietary assets, or copied branded artwork.

## v0.3 release additions

- The home route is a compact start flow: display name, Solo or Multiplayer,
  conditional Solo bot level, and one primary action.
- Accepted moves receive a short destination animation; captures also receive a
  brief impact animation. Reduced-motion preferences disable both.
- In Solo, the client previews a locally legal human move immediately. The
  server then commits that human ply on its own and returns it before Riot Bot
  starts searching. A background game read commits the pending bot reply.
  Rejection or transport failure reconciles the preview against authoritative
  state.
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

1. The player enters a display name, then chooses Solo or Multiplayer.
2. Solo reveals a five-step Bot level bar that starts at Level 3, Medium. Colors are assigned evenly and deterministically from the idempotent create request. If Riot Bot is White, its legal opening is committed before the game appears.
3. Multiplayer asks for a one, three, or five-day move pace, then opens White's reusable private game URL and shows a separate one-use invitation URL.
4. Black opens that invitation on another device, enters a display name, and claims the second seat.
5. Every human and computer move is revalidated by the server against authoritative history.
6. The board polls for changes and refreshes on focus. A player can open their private game URL on any device and restore the correct seat.

## Rules and persistence

- Standard chess only, implemented with chess.js.
- D1 stores current FEN, status, version, mode, bot level, players, hashed keys, and immutable ordered moves.
- Every move carries an expected version and idempotency key.
- A conditional update plus move insert runs atomically. Stale, illegal, wrong-turn, unauthorized, and completed-game moves do not mutate state.
- In Solo, the human move commits atomically as one ply and returns immediately.
  The client then requests Riot Bot's pending turn in the background. Riot Bot
  evaluates from its assigned color, uses bounded server-side search, and
  commits its own ply through the same chess.js rules adapter. Every
  authenticated game read also recovers a pending bot turn, so closing or
  refreshing cannot strand the game.
- Replaying move history is required before validation so repetition remains correct.
- Promotion data is accepted only when a pawn reaches its final rank.
- Threefold repetition and the fifty-move rule are player claims. Fivefold repetition and the seventy-five-move rule end automatically, after checkmate precedence.
- Before human or computer moves, immutable history must match current FEN, turn, and ply count.
- Ending a waiting game records cancellation with no winner. Ending an active
  game records resignation and the opponent as winner. Both actions are
  authenticated, version guarded, idempotent, and preserve move history.
- Joined multiplayer games derive each move deadline from the last accepted
  mutation. Reads, moves, draw claims, and resignations all enforce expiry
  atomically before accepting a later action.

## Identity and privacy

- No account is required.
- Player keys are 256-bit bearer secrets carried in a `#seat=` URL fragment and cached per game in browser storage after successful authentication. The server stores SHA-256 hashes only.
- URL fragments are never sent in HTTP requests or referrers. A private game URL is still a bearer credential, so anyone who has it can play as that seat.
- Existing same-browser games add the cached key to the URL after authentication so their next copied link is portable. A bare game URL on a new device remains unauthorized.
- Invitation links are one-use. A third party cannot read a game without one of its player keys.

## Interface

- Nine original visual themes cover the page, panels, board, and pieces. The
  default Blockfield theme uses grass, dirt, stone, wood, sand, water, and
  torch-light colors. None copy third-party game branding or assets.
- Drag and drop a piece, or tap/click a piece and then a legal destination.
- Board rotates for Black while submitted coordinates remain absolute chess squares.
- The interface shows explicit player colors, turn, check, the checked king,
  lost pieces, outcome, deadline, move history, and read-only replay.
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
