# Acceptance tests

## Public home and guest access

1. Open `/` with and without Sites identity headers and verify the rendered
   HTML is identical, fixed-style, and contains no name, theme picker, sign-in
   prompt, CAPTCHA request, or ChessRiot access cookie.
2. Save a non-default theme, reload `/`, and verify the public homepage remains
   visually unchanged.
3. Open `/app` without identity headers, enter a name, create a Solo game, and
   verify the private seat link can reopen it in a storage-empty browser.
4. Create a Multiplayer game as a guest, review the invitation in another
   browser, join with a second name, and complete one move from each private
   seat.
5. Verify missing or wrong seat tokens remain blocked, origin checks still
   reject cross-site mutations, and identity-scoped rate limits remain active.
6. Open an old `/verify?failed=1&return_to=%2F` link and verify it redirects
   safely to `/app` without showing a retired check.

## Solo happy path

1. Enter a name, choose Solo, and verify Bot level starts at Level 3, Medium.
2. Move the level lower and higher, then restore Medium and create the game.
3. Verify both color assignments: as White, drag e2 to e4 and verify the pawn
   appears immediately, followed almost at once by Riot Bot's local reply; as
   Black, verify Riot Bot's White opening exists before the board becomes
   playable.
4. Verify the move request returns the same displayed bot reply, atomically
   stores both plies, advances the authoritative version by two, and returns
   the turn to the human without a follow-up game request.
5. Simulate a legacy game stored after only the human ply, then close or
   refresh and verify the next authorized load completes the pending bot turn.
6. Reopen the private link and verify the same board, level, history, and turn.
7. Complete a Solo game and verify Riot Bot does not move after checkmate or another terminal result.
8. At every level, use the same turn seed in browser and server search and
   verify the selected move is identical. At Level 5, verify one legal move
   returns within 2.5 seconds and immediate checkmates remain selected.

## Two-player happy path

1. Browser A creates a game, chooses one, three, or five days per move, and receives an invitation.
2. Browser B joins and Browser A observes the state change.
3. A makes a legal move; B sees the same FEN, history, and turn.
4. B replies; both refresh and reopen to the same authoritative state.
5. Complete Fool's Mate and verify checkmate, Black winner, four plies, and no further moves.
6. Backdate a live player turn beyond its selected pace, load the game, and
   verify the waiting player loses on time before a late move can commit.

## Magic Rules

1. Open `/app`, leave Magic Rules off, and create Solo and Multiplayer games.
   Verify both remain standard chess and make no model request.
2. Enable Magic Rules and create games from equivalent normalized prompts.
   Verify the first cache miss makes one provider request and later creations
   reuse the validated D1 document. While the first provider request is held,
   verify an identical request-id and fingerprint returns retryable `503`, a
   different prompt with that request id returns `409`, and neither performs a
   second rate-limit or provider action. After success, an exact retry returns
   the existing game.
3. Verify `Knights move twice`, `Knights move 2 times`, `Knights move 3 times`,
   and the Hebrew equivalent of `Knights move 3 times` compile to exact v3
   counts. Verify any prompt containing an unsupported clause is rejected in
   full and neither failures nor partial rules are cached.
4. Verify there is no standalone Compile or Interpret action or endpoint.
5. Play a two-leg rook turn and a three-leg knight turn. Each continuation must
   use the same physical piece; one-, two-, and three-leg early stops are legal;
   a fourth leg under a three-move rule is rejected; and check ends the turn.
6. Promote a Magic pawn on its first leg and verify the promoted physical piece
   keeps the pawn's turn-start move limit for its remaining legal legs.
7. Verify each completed sequence produces one move row, ply, version, deadline
   update, and repetition position. Verify human, Riot Bot, replay, history,
   confirmation, and sound agree, and provider-call counts do not change while
   moves are made. In Solo, submit a human Magic continuation and verify the
   human action plus Riot Bot's deterministic reply commit in one response,
   advance the version by two, and retain both continuation payloads.
8. Reopen stored v1 and v2 Magic games and verify immutable rules, history,
   replay, and legal moves remain readable.
9. Expire and reclaim an identical pending create intent. Verify the old owner
   cannot commit or delete the new lease, the reclaimed attempt does not make a
   second provider call, and a retry creates exactly one game from the cached
   rules. Verify rate-limit, provider, and rule-validation failures leave no
   owned intent behind.

## Enforcement

- Reject an illegal move, wrong player, missing or wrong key, stale version, reused invite, and post-completion move.
- Retrying an identical request id is idempotent.
- A different payload with an already-used request id conflicts.
- Concurrent authorized reads during a pending Riot Bot turn return the
  single committed bot version rather than a transient pre-bot snapshot.
- Accept a sandboxed `Origin: null` mutation only with
  `Sec-Fetch-Site: same-origin`. Reject the same opaque origin with missing,
  `same-site`, `cross-site`, or `none` metadata, plus explicit host, scheme, or
  port mismatches.

## Rules

- Castling both sides and castling restrictions
- En passant, expiry, and pinned-pawn rejection
- Promotion to queen, rook, bishop, and knight
- Reject promotion metadata on an ordinary move
- Check, checkmate, stalemate, insufficient material, claimable threefold/50-move draws, and automatic fivefold/75-move draws
- Claim an available draw and verify it is idempotent and versioned
- While in check, reject a non-evasion with check-specific guidance and accept a legal king move, capture, or block.
- End an active game as a versioned, idempotent resignation with the opponent as winner.
- Cancel a waiting game with no winner and invalidate its invitation.

## Persistence

- Reload and close/reopen the browser.
- Copy White's private game link into a storage-empty browser and verify it restores White.
- Copy Black's private game link into another storage-empty browser and verify it restores Black.
- Clear browser storage, reopen each private link, and verify both seats still work.
- Open a legacy bare game URL on its original browser and verify it upgrades to a `#seat=` private URL.
- Reject a bare URL on a new browser and malformed, missing, or wrong seat tokens.
- Do not overwrite a working cached token until a different linked token authenticates successfully.
- Verify no HTTP request URL or referrer contains the `#seat=` secret.
- Restart the local Worker runtime against the same D1 data and verify the completed game remains.

## Interface and sound

- Verify the public homepage is fixed and identity-independent. Verify the
  palette control appears only on active `/g/*` routes.
- Open the palette by mouse and keyboard, verify exactly 11 named choices,
  select each choice, and verify a non-color selected marker.
- Select a non-default theme and reload the game. Verify it applies before
  paint and across a second tab, then navigate to `/`, `/app`, `/join/*`, and
  `/changelog` and verify those fixed pages do not inherit it.
- Verify every theme changes active game panels, board, captured pieces, and
  both piece colors while preserving readable White/Black contrast.
- Verify invalid or unavailable local storage falls back to Riot without
  breaking the current page.
- Verify desktop and mobile layouts use an original visual identity and keep the full board readable without browser zoom or horizontal overflow.
- At 1366×768, verify the player cards, captured strip, status, and complete board fit in the viewport.
- Verify each player name is paired with the correct readable White/Black label and YOU marker from both seats.
- Verify captured pawns and pieces appear under the color that lost them, including en passant.
- Verify the checked king square and CHECK banner are visually prominent without relying on sound.
- Verify the fixed public, create, invitation, changelog, and error states are
  coherent, while every active-game theme keeps solid board squares, flat
  vector pieces, and clean state rings without bevels or hard offset shadows.
- Verify runtime text, requests, and assets contain no third-party block-game branding.
- Play one distinct cue for a move, capture, check, win, loss, draw, and invalid action.
- Do not play on first load, refresh, join-only state changes, repeated polls, or an out-of-order snapshot.
- Persist mute state and verify turning sound back on plays one short confirmation cue.
- Recover from an initial game or invitation network failure with the on-screen retry action.
- Drag a legal move with mouse and touch and verify exactly one move is submitted.
- Drop off-board or on an illegal square and verify the piece snaps back with no mutation.
- Verify tap/click and keyboard moves still work after drag-and-drop is enabled.
- Use the always-visible Previous and Next controls from both White and Black
  orientation. Verify the main board, last-move highlight, checked king, and
  captured pieces match the selected committed ply.
- Stay on a historical ply while a Solo bot reply or Multiplayer poll adds a
  move. Verify the board remains pinned, the total increases, Forward reaches
  the new position, and Go Live returns to current play.
- During the immediate Solo move preview, press Back and verify it shows the
  position immediately before the visible move rather than skipping a ply.
- Stage the first leg of a multi-step Magic move, then press Back. Verify the
  draft is cancelled and the latest authoritative position is shown.
- Verify history browsing never submits a move, claim, or Magic turn and
  suppresses live move effects and the checkmate finisher. Verify the historical
  board squares are not keyboard tab stops.
- Verify Confirm every move is off by default. Enable it under Move Settings,
  reload and open another game in the same browser, and verify it remains on.
- With confirmation enabled, verify tap, pointer drag, keyboard activation,
  promotion, Magic Finish Turn, and a multi-leg Magic move each open exactly one
  dialog and send no move before CONFIRM MOVE.
- Verify KEEP THINKING, Escape, and backdrop cancellation send no move. Verify
  CONFIRM MOVE sends exactly one move, a rapid second activation cannot
  duplicate it, bot replies never prompt, and a changed game version dismisses
  the stale intent. After cancel, return focus to the trigger; after commit or
  promotion, return it to the match status.
- In an active joined two-player game, send each preset cheer from both seats
  and verify both players see the same bounded stream.
- Verify identical reaction retries are idempotent, conflicting request reuse
  is rejected, rapid repeat reactions are rate-limited, unauthorized and Solo
  reactions are rejected, prior reactions remain readable after completion,
  only Good Game and Thanks work during the 15-minute post-game courtesy
  window, later reactions are rejected, and no free-form text can be submitted.
- Open Game Replay and verify Start, Back, Next, End, arrow keys, Home, End,
  and Return to Live all reconstruct history without changing live state.
- Deliver checkmate while both players are open. Verify one short finisher uses
  the actual winning piece, does not replay on refresh, excludes non-checkmate
  endings, and becomes static under reduced motion.
- Verify the manifest and install icons support a standalone desktop-style
  install. Confirm the service worker never caches game, join, or API routes.
- Verify a new release produces a subtle blue dot until opened. Confirm the
  App panel exposes Turn alerts only for multiplayer games when complete VAPID
  configuration is present.
- On Android Chrome, enable Turn alerts for one multiplayer game, fully close
  ChessRiot, commit an opponent move from another device, and verify exactly one
  generic notification opens the correct game without exposing names, seat
  tokens, or private links.
- Associate the same browser push subscription with two games. Disable one and
  verify the other remains enabled. Verify a retry of the same committed move
  sends no second notification, failed delivery never changes the move result,
  and a 404 or 410 push response removes the stale endpoint associations.

## Observability

- Verify Development, Staging, and Production write only to their own D1.
- Verify create, invite, join, accepted/rejected moves, bot moves, draw claims, errors, and health checks appear with environment, release, request id, outcome, and latency.
- Verify unchanged polling creates no event.
- Verify route normalization and HMAC game references never expose ids, tokens, names, links, fragments, FENs, raw bodies, IPs, or user agents.
- Verify expired/tampered/wrong-environment read grants are rejected.
- Verify the control panel preserves a visibly stale last-good snapshot and never substitutes fake zeroes.
