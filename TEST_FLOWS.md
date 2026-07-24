# Acceptance tests

## Solo happy path

1. Enter a name, choose Solo, and verify difficulty starts at 3, Medium.
2. Move the difficulty lower and higher, then restore Medium and create the game.
3. Drag White's e-pawn from e2 to e4 and verify Riot Bot replies.
4. Verify the human move and bot reply persist together, the move log shows two plies, and the turn returns to White.
5. Refresh and reopen the private link and verify the same board, difficulty, history, and turn.
6. Complete a Solo game and verify Riot Bot does not move after checkmate or another terminal result.

## Two-player happy path

1. Browser A creates a game and receives an invitation.
2. Browser B joins and Browser A observes the state change.
3. A makes a legal move; B sees the same FEN, history, and turn.
4. B replies; both refresh and reopen to the same authoritative state.
5. Complete Fool's Mate and verify checkmate, Black winner, four plies, and no further moves.

## Enforcement

- Reject an illegal move, wrong player, missing or wrong key, stale version, reused invite, and post-completion move.
- Retrying an identical request id is idempotent.
- A different payload with an already-used request id conflicts.

## Rules

- Castling both sides and castling restrictions
- En passant, expiry, and pinned-pawn rejection
- Promotion to queen, rook, bishop, and knight
- Check, checkmate, stalemate, repetition, insufficient material, and fifty-move draw

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

- Verify desktop and mobile layouts use the original voxel/block-world identity and keep the full board readable without horizontal overflow.
- Verify block depth and shaded-face treatments are coherent across the home, invitation, board, private-link, and error states.
- Verify runtime text, requests, and assets contain no third-party block-game branding.
- Play one distinct cue for a move, capture, check, win, loss, draw, and invalid action.
- Do not play on first load, refresh, join-only state changes, repeated polls, or an out-of-order snapshot.
- Persist mute state and verify turning sound back on plays one short confirmation cue.
- Recover from an initial game or invitation network failure with the on-screen retry action.
- Drag a legal move with mouse and touch and verify exactly one move is submitted.
- Drop off-board or on an illegal square and verify the piece snaps back with no mutation.
- Verify tap/click and keyboard moves still work after drag-and-drop is enabled.
