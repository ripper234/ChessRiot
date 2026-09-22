# Acceptance tests

## Public home, guest play, and account access

1. Open `/` with and without Sites identity headers and verify the rendered
   HTML is identical, fixed-style, and contains no name, theme picker, sign-in
   prompt, CAPTCHA request, or ChessRiot access cookie.
2. Save a non-default theme, reload `/`, and verify the public homepage remains
   visually unchanged.
3. Without a Google session, create a guest Solo and Multiplayer game, join by
   invitation, open each exact private seat link, and complete one move from
   each player.
4. Sign in, create a Solo and Multiplayer game, join from a second Google
   account, and verify those account-owned games are available in a
   storage-empty browser.
5. Verify missing or wrong seat tokens, unrelated account membership,
   cross-site mutations, and identity-scoped rate limits remain blocked.
6. Open an old `/verify?failed=1&return_to=%2F` link and verify it redirects
   safely to `/app` without showing a retired check.

## Optional Google login and legal pages

1. With incomplete Google configuration, verify `/api/auth/session` reports
   `available: false`, the Google account control is hidden, and guest create,
   join, read, move, and notification actions still work through
   exact private-seat authorization.
2. Configure Development with only `GOOGLE_CLIENT_ID_DEV`, secret
   `GOOGLE_CLIENT_SECRET_DEV`, and secret `GOOGLE_AUTH_SESSION_SECRET_DEV`.
   Verify the authorization request uses exactly
   `https://dev.chessriot.gg/api/auth/google/callback`, `openid email profile`,
   signed state, nonce, and S256 PKCE. Confirm Production credentials cannot be
   selected in Development, and vice versa.
3. Keep Dev in its Sites custom-user allowlist. As an admitted tester, open the
   canonical Dev hostname first, add the same person independently to Google's
   OAuth Audience test-user list, start Google login, and complete the callback
   in the same browser. Verify an unadmitted visitor still cannot reach any Dev
   route. Repeat from the legacy provider alias and verify login first returns
   to the canonical hostname before setting transaction state.
4. Reject missing, expired, tampered, or mismatched state; wrong nonce,
   issuer, audience, signature, expiry, or unverified email; unsafe return URLs;
   and incomplete target configuration. Verify failure clears the short
   transaction cookie, shows a bounded user-facing error, and exposes no
   provider response or secret.
5. Verify the application session cookie is host-only, Secure, HTTP-only,
   SameSite=Lax, signed, and expires after one year. Successful authenticated
   activity renews it at most daily while preserving the original Google
   authentication time used for recent-auth deletion. Sign out with a same-origin
   POST, reject cross-site sign-out, clear both flow and session cookies, remove
   account-only recent cards immediately, and verify exact private links still
   authorize their seats.
6. Create and join while signed in, then verify `/api/me/games` supplies those
   games in a storage-empty browser. Open an older private seat while signed in
   and verify the ordinary read leaves ownership unchanged. Choose the explicit
   account-link action and verify only that exact legacy seat and its push
   association migrate. Reject a wrong seat token, a non-guest owner, bulk
   linking through the guest browser token, and any attempt to own both colors.
7. Render `/privacy` and `/terms` with and without identity headers and verify
   identical public application HTML, mutual links, sitemap/robots inclusion,
   current Google disclosure, and no private route data. Confirm Dev's outer
   Sites gate still protects its copies and Production's copies are public.
8. Run the single opt-in live LLM suite test or owner-only smoke action, but not
   both, once in each environment. Verify Dev uses only `OPENAI_API_KEY_DEV`, Production uses
   only `OPENAI_API_KEY_PROD`, the result is `CHESSRIOT_OK`, and the request
   contains no game, player, feedback, or private-link data.

## Required fields and combat

1. On `/app`, submit with an empty or whitespace-only display name by button
   and Enter. Verify the enabled action sends no request, the input turns red,
   receives focus, exposes `aria-invalid=true`, and references its visible
   error. Type a valid name and verify the error clears immediately.
2. Repeat the same checks for the invitation display name and Feedback title at
   1366×768 and 390×844. Keep storage/network errors separate, and verify a
   successful Feedback submission resets its validation state.
3. Capture with every piece as a human and as Riot Bot. Verify each attacker
   keeps its own action, the victim reacts, and the committed or optimistic
   board is already current underneath the pointer-transparent overlay.
4. Start the next legal interaction before combat ends and verify the
   decoration clears immediately without disabling the board or duplicating a
   request. No interface may show `LOCKING MOVE`.
5. Verify captures from both orientations, en passant's real victim square,
   capture promotion as a pawn, both legs of an atomic Magic capture, and a
   Mini Game or Mating Set position with a nonstandard initial FEN.
6. Refresh, repeat an unchanged poll, reject an optimistic move, open history,
   background the page, and enable reduced motion. None may replay stale combat
   or replace the final authoritative position.
7. Open `/capture-lab`, replay all six actions, and verify the production
   animation component and reduced-motion marker at desktop and mobile widths.

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

## Mobile recovery, acceptance, Activity, and Hebrew first paint

1. Delay the account session, invitation preview, referral claim, and game JSON
   body independently past the read deadline. Verify each protected route has a
   safe Home action while loading, then exposes Retry without becoming stuck;
   a late older response must not replace the newest successful state.
2. Open `/invite/*` and verify it is described in Hebrew as a player/referral
   link, never as a game link. Open `/join/*` and verify it is the private game
   invitation flow. Lose the successful join response, retry from the same
   account with a newly generated local seat key, and recover the accepted game
   without giving either account both colors.
3. Register the creator's exact account device, accept a link invitation as the
   other account, and verify exactly one durable White-turn delivery targets the
   creator with the accepted game and version. Retry the claim and verify no
   duplicate. Repeat for direct challenge acceptance; verify decline, failure,
   replay, and competing acceptance enqueue nothing.
4. On the creator URL containing `challenge=sent` or `invitation=created`, accept
   from the other device. Verify the creator's next authoritative snapshot
   removes those one-use query parameters and waiting copy, closes an obsolete
   invitation panel, and enables White's legal move on the active board.
5. Open `/app`, `/g/*`, `/join/*`, History, and Privacy Center while signed in.
   Verify exactly one fixed bell opens Activity on every route, refreshes after
   focus/visibility/online changes, and an intentionally delayed older response
   cannot overwrite a newer unread or active result. Verify no bell while
   signed out.
6. Deny notifications in Android Chrome. Verify the Settings control remains
   badged and a prominent non-blocking Hebrew recovery control appears on every
   signed-in screen. Open its exact notification section, follow the displayed
   Android/Chrome steps, restore permission, choose the explicit recheck action,
   and verify recovery clears. An in-app disable or dismissal must not nag.
7. With Android Chrome automatic translation enabled and every API response
   delayed in turn, capture the account gate, game loading, invitation loading,
   ready game menu, and Settings first frame. They must contain native Hebrew
   with no intermediate English menu copy. Verify the board remains White-at-
   bottom for White and Black-at-bottom for Black, with files, ranks, SAN,
   clocks, codes, and links retaining left-to-right order under the RTL shell.

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

1. Enable Magic Rules for one account in Control. Open `/app`, turn Magic on,
   and verify the textarea is empty with placeholder `e.g. Knights move twice`.
2. Verify the account begins with 10 credits. Enter a supported rule and select
   **Apply Magic**. Confirm one credit is removed, one compact `0x` World code
   appears, and game creation does not call the compiler again.
3. Apply an equivalent phrase in another language from another account. Confirm
   it resolves to the same World code and preserves the first creator.
4. Retry Apply and game creation with the same request ID. Confirm neither the
   debit nor game duplicates. Submit identical Apply calls concurrently and
   confirm both converge on one debit and entitlement. Submit different
   payloads concurrently under one ID and confirm exactly one succeeds.
   Reusing the ID for a different World must fail.
5. Open `/worlds`, inspect Map, Popular, New, and Mine, then fork a World. Verify
   the parent-to-child connection and that self/cyclic edges are absent.
6. Start a Magic game and verify no Magic banner appears above the board. World
   rules, compact code, creator, and link must appear in the desktop sidebar and
   mobile World drawer.
7. Before the first move, confirm the game does not enlarge the World or earn a
   royalty. After the first committed move, it counts once. Five qualifying
   games paid by accounts other than the creator award exactly one credit.
8. Confirm self-play earns no royalty, a failed compilation does not debit, and
   an account with zero credits cannot compile or play a new Magic game.
9. Complete one qualifying referral and confirm the inviter earns 10, not 100.
   Export account data and verify the full credit ledger and created World codes
   appear without raw prompts. Confirm creator-only usage is aggregated by
   World and never exposes another player’s game ID or play timestamp.
10. Interrupt Apply after transmission, reload, and confirm the unfinished
    request is restored for exact retry. A completed unconsumed entitlement
    must also recover when browser reservation storage is missing. Exhaust the
    fresh-Apply quota and confirm an exact pending-debit retry still completes.

1. Open `/app` with an ordinary account and verify Magic Rules remains visible
   as locked early access with one `REQUEST AN INVITE` action and no prompt.
2. Send the request. Verify the action becomes a durable `REQUESTED` state,
   repeating the API request creates no duplicate, and Magic game creation is
   still rejected.
3. In owner-only Control, verify the exact red count, Dev/Production isolation,
   username, request age, honest unavailable states, and no leaked account id.
4. Approve one request and verify the request disappears, the existing feature
   flag becomes enabled, replayed approval fails, and the account may create a
   supported Magic game. Disable it and verify access is removed.
5. Submit another request, choose `NOT NOW`, and verify the request disappears
   without enabling Magic Rules. Verify account export includes a pending
   request and account deletion removes it.
6. Reopen an older stored Magic game and verify its immutable rules, history,
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
- Open Game Replay and verify Start, Back, Next, End, arrow keys, Home, End,
  and Return to Live all reconstruct history without changing live state.
- Deliver checkmate while both players are open. Verify one short finisher uses
  the actual winning piece, does not replay on refresh, excludes non-checkmate
  endings, and becomes static under reduced motion.
- Verify the manifest and install icons support a standalone desktop-style
  install. Confirm the service worker never caches game, join, or API routes.
- Verify a new release produces a subtle blue dot until opened. With site data
  cleared and browser permission at default, confirm both a newly named account
  and an existing signed-in account receive the same optional notification
  step before the requested route, including `/g/*` and invitation routes.
  Verify **Not now** enters play immediately while configuration is loading and
  while a native permission promise is pending. **Enable notifications** must
  invoke the native request once, and browser Allow must also enter play
  immediately while subscription and server registration continue in the
  background. Reload, navigate, open another game, sign out, and sign in as the
  same or a different username; verify no automatic ask repeats after skip,
  allow, block, dismissal, or thrown-request results. Open two tabs concurrently
  and verify only one can claim the optional ask and a wedged Web Lock fails
  open. Interrupt or fail service-worker readiness, subscription creation,
  server PUT, response parsing, and consent-cache persistence separately;
  verify play remains available, reload never re-enters onboarding, no failure
  message renders above play, Settings shows the correct stage-specific recovery,
  and a deliberate retry succeeds. After browser Allow, close the tab before the
  account decision advances; reload and verify `onboarding` resumes as pending
  without another prompt. Trigger focus reconciliation during manual setup and
  verify neither operation removes the healthy result. Race Not now against a
  successful Settings enable and verify the explicit enabled decision wins.
- On Android Chrome, enable notifications once, start a second multiplayer game,
  fully close ChessRiot, commit opponent moves in both games, and verify exactly
  one generic notification per move opens the exact game without names, seat
  tokens, or private links. Settings must describe one global device toggle.
- On Android Brave with Google push messaging disabled, verify enablement fails
  with instructions to turn on Use Google Services for Push Messaging and allow
  both Brave and ChessRiot notifications. Enable them, retry, close Brave, and
  verify an opponent move produces exactly one notification for the right game.
- Preserve a legacy per-game subscription without widening it. Explicitly opt
  that same endpoint into account notifications and verify matching legacy rows
  disappear, existing and future games are covered, multiple devices each get
  one alert, and a repeated subscription or committed move creates no duplicate.
  Before widening it, verify Settings reports **Limited**, not Off, and turning
  it off deletes the legacy row and browser subscription. Verify explicit
  sign-out, cookie/session loss, account switching, deletion,
  permission revocation, expiration, and 404/410 remove only the intended
  device state. Exhaust enable-write quota and confirm opt-out still works.
  Rotate the browser subscription while ChessRiot is closed and verify the
  service worker rebinds it only when its cached consenting username still
  matches the account session. Race account switching and revocation against
  rotation and verify the old owner cannot attach or remove the new owner&apos;s
  endpoint. Race an old
  delivery response against key rotation and verify it cannot disable the new
  keys. Transient delivery failure must never change the move result.
- In Control, inspect one Unicode or ASCII username in Dev and Prod. Verify only
  active device count and last acceptance are returned. Send a 1–120 character
  test/service message, confirm Production explicitly, and report provider
  acceptance rather than delivery. Retry the exact signed command after a lost
  response and verify its stored result is returned without a second outbound
  push, even if the device or configuration changed meanwhile. Reject
  broadcasts, arbitrary title/path, multiline or sensitive-content guidance
  violations, changed-payload nonce reuse, wrong origin/owner/environment,
  over-budget sends, and usernames absent from that environment. Logs must omit
  username, body, endpoint, keys, and provider IDs.

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
# Mobile filters and zoom (v0.31.1)

- On a 360px/393px phone, open History and repeatedly select Solo, All,
  Multiplayer, All. Each selected chip and resulting game list must agree.
- Open Game Type and Rules after each mode change; choose a non-default option
  then All. Taps near the centre and edges must reach that control.
- Open Settings, change Language and a skin, and verify all controls can be
  reached. History HOME and Settings must not overlap. Tab/arrow-key radio
  navigation must retain a visible focus ring.
- Pinch to enlarge and shrink Settings, History and the board. Start the board
  pinch on a piece, with the other finger on an empty square or outside the
  board. No move may be sent. Repeat while a piece is being dragged.
- After pinching, make one legal drag, a two-tap move, and a keyboard move.
  Check both colors, including a premove while the opponent thinks.
