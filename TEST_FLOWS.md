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

## Mini Games

1. Open `/app` and verify Classic Chess is selected without opening the game
   menu. Open the menu by mouse and keyboard and verify Pawn Riot, Half Army,
   and Pawn Duel are grouped under Mini Games.
2. Select every setup and verify the chooser closes, the selected loadout is
   visible, and changing Solo or Multiplayer does not reset it.
3. Create each Mini Game in Solo as both White and Black. Verify Riot Bot opens
   from the selected setup when it is White, every reply is legal, and the
   immutable initial position survives refresh, history, and replay.
4. Create each Mini Game in Multiplayer. Verify the invitation names the game
   before Black joins, both seats receive the same variant id and initial FEN,
   and play resumes correctly from private links on separate devices.
5. Verify Standard remains the default for omitted variant ids and legacy
   rows. Reject unknown ids, raw client FENs, a changed variant on an
   idempotent retry, and any Mini Game combined with a Magic prompt.
6. Verify the active Mini Game banner, Game Info, captured-piece lists, recent
   game cards, deadlines, check guidance, checkmate finisher, and replay all
   reflect the selected starting army.
7. At 320x568, 390x844, landscape, keyboard-only navigation, and 200% zoom,
   verify the game menu remains usable, focus returns to its trigger, and no
   fixed control overlaps it.

## Magic Rules

1. Open `/app` and verify Magic Rules remains visible.
2. Verify its interior says `COMING SOON` and contains no textarea, prompt,
   Compile Rules action, Interpret Rules action, or network request.
3. Create Solo and Multiplayer games and verify both use standard chess with no
   new Magic banner.
4. Reopen an older stored Magic game and verify its immutable rules, history,
   replay, and legal moves remain readable for backwards compatibility.

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
- Stage the first leg of a two-step Magic move, then press Back. Verify the
  draft is cancelled and the latest authoritative position is shown.
- Verify history browsing never submits a move, claim, or Magic turn and
  suppresses live move effects and the checkmate finisher. Verify the historical
  board squares are not keyboard tab stops.
- Verify Confirm every move is off by default. Enable it under Move Settings,
  reload and open another game in the same browser, and verify it remains on.
- With confirmation enabled, verify tap, pointer drag, keyboard activation,
  promotion, Magic Finish Turn, and a two-leg Magic move each open exactly one
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

- Verify Development and Production write only to their own D1.
- Verify create, invite, join, accepted/rejected moves, bot moves, draw claims, errors, and health checks appear with environment, release, request id, outcome, and latency.
- Verify game creation and bot telemetry include only the allowlisted variant
  id, never an initial or current FEN.
- Verify unchanged polling creates no event.
- Verify route normalization and HMAC game references never expose ids, tokens, names, links, fragments, FENs, raw bodies, IPs, or user agents.
- Verify expired/tampered/wrong-environment read grants are rejected.
- Verify the control panel preserves a visibly stale last-good snapshot and never substitutes fake zeroes.
- Verify feedback counts remain exact beyond the 100-item overview cap and that
  `new` plus `reviewed` equals unresolved while `closed` does not.
- Verify a scoped feedback-management grant closes an item, a repeated close is
  a successful no-op, and missing items return 404. Read-scope, expired,
  tampered, wrong-origin, and wrong-content-type attempts must return 403.
- Verify close events use `feedback.closed` and the normalized
  `/api/ops/feedback/:id/close` route without recording the feedback id, title,
  comment, or signed grant.
