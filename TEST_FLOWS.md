# Acceptance tests

## Solo happy path

1. Enter a name, choose Solo, and verify Bot level starts at Level 3, Medium.
2. Move the level lower and higher, then restore Medium and create the game.
3. Verify both color assignments: as White, drag e2 to e4 and verify the pawn appears on e4 immediately while Riot Bot is still thinking; as Black, verify Riot Bot's White opening exists before the board becomes playable.
4. Verify the human move becomes durable before Riot Bot replies, then verify
   the bot reply animates, the move log shows two plies, and the turn returns to
   White.
5. Close or refresh after the human ply but before the bot ply and verify the
   next authenticated load completes the pending bot turn.
6. Reopen the private link and verify the same board, level, history, and turn.
7. Complete a Solo game and verify Riot Bot does not move after checkmate or another terminal result.

## Two-player happy path

1. Browser A creates a game, chooses one, three, or five days per move, and receives an invitation.
2. Browser B joins and Browser A observes the state change.
3. A makes a legal move; B sees the same FEN, history, and turn.
4. B replies; both refresh and reopen to the same authoritative state.
5. Complete Fool's Mate and verify checkmate, Black winner, four plies, and no further moves.
6. Backdate a live player turn beyond its selected pace, load the game, and
   verify the waiting player loses on time before a late move can commit.

## Enforcement

- Reject an illegal move, wrong player, missing or wrong key, stale version, reused invite, and post-completion move.
- Retrying an identical request id is idempotent.
- A different payload with an already-used request id conflicts.

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

- Verify the textless palette control appears on home, join, game, changelog,
  loading, and error states, while the exact current version remains visible.
- Open the palette by mouse and keyboard, verify exactly nine named choices,
  select each choice, and verify a non-color selected marker.
- Select a non-default theme, reload and navigate between home, join, game, and
  changelog. Verify the same theme applies before paint and across a second tab.
- Verify every theme changes the page, panels, board, captured pieces, and both
  piece colors while preserving readable White/Black contrast.
- Verify invalid or unavailable local storage falls back to Blockfield without
  breaking the current page.
- Verify desktop and mobile layouts use an original visual identity and keep the full board readable without browser zoom or horizontal overflow.
- At 1366×768, verify the player cards, captured strip, status, and complete board fit in the viewport.
- Verify each player name is paired with the correct readable White/Black label and YOU marker from both seats.
- Verify captured pawns and pieces appear under the color that lost them, including en passant.
- Verify the checked king square and CHECK banner are visually prominent without relying on sound.
- Verify block depth and shaded-face treatments are coherent across the home, invitation, board, private-link, and error states.
- Verify runtime text, requests, and assets contain no third-party block-game branding.
- Play one distinct cue for a move, capture, check, win, loss, draw, and invalid action.
- Do not play on first load, refresh, join-only state changes, repeated polls, or an out-of-order snapshot.
- Persist mute state and verify turning sound back on plays one short confirmation cue.
- Recover from an initial game or invitation network failure with the on-screen retry action.
- Drag a legal move with mouse and touch and verify exactly one move is submitted.
- Drop off-board or on an illegal square and verify the piece snaps back with no mutation.
- Verify tap/click and keyboard moves still work after drag-and-drop is enabled.
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
- Verify a new release produces a subtle blue dot until opened. Opt into move
  notifications, background the still-open tab, make an opponent move, and
  verify one notification. Confirm the UI does not claim closed-app push.

## Observability

- Verify Development, Staging, and Production write only to their own D1.
- Verify create, invite, join, accepted/rejected moves, bot moves, draw claims, errors, and health checks appear with environment, release, request id, outcome, and latency.
- Verify unchanged polling creates no event.
- Verify route normalization and HMAC game references never expose ids, tokens, names, links, fragments, FENs, raw bodies, IPs, or user agents.
- Verify expired/tampered/wrong-environment read grants are rejected.
- Verify the control panel preserves a visibly stale last-good snapshot and never substitutes fake zeroes.
