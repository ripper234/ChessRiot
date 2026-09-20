# ChessRiot v0.27.7 specification

## v0.27.7 mobile recovery, activity, and Hebrew game correction

- Every protected game, game-invitation, referral, account-gate, Activity, and
  Settings loading state renders its native Hebrew copy synchronously. These
  surfaces declare Hebrew and opt out of automatic page translation before the
  first paint, while chessboards, coordinates, notation, codes, links, and
  clocks retain their exact left-to-right order.
- Initial session, referral, invitation, and game reads are bounded through
  both response headers and JSON body consumption. On protected routes a
  stalled or disconnected read exposes an immediate safe route home and manual
  retry; session and game reads also retry automatically, and stale completions
  cannot replace a newer screen state.
  `/invite/*` is labeled as a player/referral link and `/join/*` remains the
  only private game-invitation claim path.
- Link and direct-challenge acceptance atomically enqueue the creator's first
  White-turn notification once. A lost join response is recoverable by the
  same account even after the browser creates a fresh local seat key, while
  retries, declines, failures, and competing accepts cannot duplicate a push.
- The signed-in Activity bell is available once on every protected route,
  refreshes on focus, visibility, connectivity, and a bounded poll, and cannot
  be rolled back by an older request. Acceptance replaces one-use waiting copy
  with the authoritative active game and closes the obsolete invitation panel.
- An Android browser-level notification block stays visibly badged and shows a
  prominent, non-blocking recovery control above signed-in play. Recovery opens
  the exact in-app Settings section, gives safe Android/Chrome steps, and offers
  an explicit status recheck without claiming that the Web Notifications API
  can open a protected operating-system settings screen.

## v0.27.6 multiplayer deadline correction

- One-, three-, and five-day multiplayer games derive every active-turn
  deadline from the last accepted mutation. Waiting games have no deadline,
  accepted moves reset it, and rejected or replayed writes leave it unchanged.
- Move, draw-claim, resignation, and reaction writes compare the authoritative
  deadline with SQLite statement time. A write at or after the deadline cannot
  beat timeout adjudication, and a lazily detected timeout is persisted at the
  exact deadline rather than at the later detection time.
- Account game lists and Activity settle every overdue game in one conditional
  database update before returning. Both seats therefore see the same timeout
  result without first opening the board, and expired turn pushes are
  suppressed before provider delivery.
- Invitation previews require the same signed-in account and username gate as
  the rest of play. Link and direct-challenge acceptance disclose the selected
  pace, stale browser seat storage cannot redirect another account, and a
  newly created link remains copyable even when local storage is blocked.
- Only the creator can cancel a waiting direct challenge. The invited player
  accepts or declines through the challenge response, and accepted direct
  challenges support the same reaction and deadline lifecycle as link games.

## v0.27.5 notification lifecycle correction

- An opted-in account whose browser subscription expired, disappeared, or was
  detached during a VAPID key rotation is automatically resubscribed and saved
  on the next signed-in page lifecycle while browser permission remains granted.
  A deliberate disable or dismissal is never widened.
- A game clears its retained turn notice only while the authoritative page is
  both visible and focused. Turn payloads carry the game version; the service
  worker re-alerts a retained same-game tag only for a newer version, ignores an
  exact delivery retry, serializes overlapping same-game display decisions, and
  refuses to let a stale page clear a newer notice.
- Request-time delivery uses isolated one-row lane batches. Healthy due backlog
  continues immediately while the safety budget has room, an exception in one
  lane cannot cancel the other, and slow providers leave unclaimed rows for a
  later wake instead of creating a large expiring lease batch.
- Provider-stale targets are disabled before their delivery becomes `stale`, so
  30-day audit rows survive foreign-key cascades. Disablement is monotonic across
  concurrent sends and registration, while active-target cap eviction also
  soft-disables its parent before the pending row becomes terminal. Expired
  leases at the maximum attempt count and rows older than the delivery window
  become terminal `dead` on the next drain. Regression coverage includes stale
  provider races, account and legacy cap eviction, exhausted-row recovery,
  focus-aware clearing, subscription repair, overlapping version-aware
  re-alerting, lane isolation, backlog continuation, and budget exhaustion.

## v0.27.4 Sites-compatible notification retry correction

- A qualifying request drains durable opponent-turn and friend-request rows
  immediately, after about 2.1 seconds, and, when the 25-second safety budget
  permits, after about 17.2 seconds. The final round is capped to one row per
  failed notification lane.
- Each round retains the existing lease, attempt, age, game-version, membership,
  block, expiry, and stale-endpoint checks. Successful lanes are not repeated,
  and due failed rows are prioritized ahead of fresh pending rows.
- The request-time policy has unit coverage for early success, failed-lane
  selection, final-round limits, and slow-drain budget exhaustion. End-to-end
  coverage proves a `503`, `503`, `201` provider sequence reaches sent state on
  attempt three.
- The Sites deployment is not described as autonomous. Rows due after the
  request-time window remain durable and resume on a later non-health API
  request until a host-supported queue or recurring trigger is available.

## v0.27.3 scheduled notification retry attempt

- The release artifact declared an every-minute Cron Trigger for the existing
  scheduled notification drain, but live Development logs showed no scheduled
  invocation after the provider propagation window.
- The scheduled drain preserves the existing lease, attempt, age, game-version,
  membership, block, expiry, and stale-endpoint checks. Fetch-triggered delivery
  and its short retry remain in place for low-latency success.
- v0.27.4 removes product reliance on the unverified trigger. The dormant
  scheduled handler remains available for a future host-supported deployment.

## v0.27.2 mobile Control notification correction

- Owner-triggered service and test messages now use high Web Push urgency, the
  same immediate-delivery class already used by the working exact-device test,
  opponent-turn alerts, and friend-request alerts. A provider acceptance still
  is not described as proof that the operating system displayed a banner.
- Diagnostic and ordinary service messages now share one persistent branded
  notification presentation. Diagnostic messages add only receipt metadata;
  they no longer exercise a more visible presentation path than Control.
- Control message tags use a bounded opaque digest derived from the one-time
  grant nonce, so every valid grant produces a safe unique notification tag
  even if a future authorized sender uses a non-UUID nonce.

## v0.27.1 notification diagnostics correction

- The exact-device test runs sequentially. It first creates a persistent local
  notification with a unique tag, then calls `getNotifications()` on the same
  active service-worker registration to verify that the browser retained it.
  A separate exact-ID local lifecycle channel distinguishes a fast click or
  close from a notification that was never retained.
  Before testing, the page requests a service-worker update and completes a
  version handshake with the active v0.27.1 worker, preventing an older worker
  from producing a false receipt timeout.
- A server self-test contains an opaque UUID diagnostic marker inside the
  encrypted push payload. The service worker returns exact-ID stages for push
  receipt, `showNotification()` resolution or rejection, retained-notification
  state, and notification interaction only to same-origin open window clients.
  The initiating page listens before sending, buffers early stages, and starts
  its 15-second deadline only after the push service accepts the request.
- Results distinguish local browser registration, push-service acceptance, and
  service-worker receipt and notification creation. Only a click is treated as
  user interaction; a close remains an unconfirmed platform event, and a
  retained notification is still not proof that the player saw a banner.
  Provider HTTP success is never described as device delivery. The operating
  system exposes no reliable web API for that final visual fact.
- Desktop Windows recovery points to Brave Browser app notifications, banners,
  Notification Center, and Do Not Disturb instead of Android settings. Desktop
  Brave players also receive a link to Brave’s independent notification test.
- Diagnostic markers are UUID-bound to the current exact-device request, never
  logged with endpoints or account data, and do not widen Control’s service
  message or destination permissions.

## v0.26.3 notification recovery correction

- Post-permission setup records a bounded failure stage for configuration,
  service-worker readiness, subscription lookup or creation, serialization,
  server status, and server registration. Telemetry contains only an enumerated
  stage and error class, never browser/provider text, endpoints, keys, or
  usernames.
- Brave-specific Google Push Messaging guidance appears only when Brave fails
  to create the browser subscription. App-key, session, rate-limit, network,
  and server failures receive their own accurate recovery copy.
- Setup failures never render above `/`, `/app`, a game, or an invitation.
  Settings retains the exact recovery message and receives a notification bell
  on mobile until the player retries or deliberately turns notifications off.
- If Android records browser permission as granted but the tab closes before
  the account decision advances from `onboarding`, the next app lifecycle
  resumes it as `setup-pending`. A late or concurrent onboarding completion
  cannot overwrite an explicit Settings decision. While the optional card is
  live, background reconciliation cannot silently convert `onboarding` to
  dismissed; an interrupted undecided card remains recoverable from Settings.
- Service-worker installation precaches public install assets independently;
  one unavailable optional asset cannot abort the worker required for Push.

## v0.26.2 release blocker correction

- Notification onboarding is optional. Its initial card and every pending
  state retain both **Enable notifications** and **Not now** paths; no browser,
  service-worker, network, storage, or push-provider failure can block play.
- The optional ask is recorded once per retained ChessRiot origin and browser
  profile, independently of username. Skip, dismissal, denial, reload, account
  changes, simultaneous tabs, and failed permission calls cannot show it again
  automatically.
- A browser Allow result exits onboarding immediately. Subscription and server
  registration continue in the ordinary app lifecycle, where interruption or
  failure becomes a non-blocking `setup-failed` state with an explicit Settings
  retry rather than another account gate.
- Subscription rotation and repair are bound to the consenting username.
  Account switches and sign-out use bounded, best-effort notification cleanup,
  so optional Push APIs can never hold authentication or navigation hostage.
- Existing per-game consent is shown truthfully as **Limited** and can be
  revoked directly. Choosing Not now never widens or silently destroys that
  narrower consent.

## v0.26.1 release correction

- Notification permission is attempted once per ChessRiot origin and browser
  profile with retained site data, not once per username. The device-scoped
  attempt marker is written before the browser API call and survives sign-out,
  account changes, notification disablement, dismissal, denial, and setup
  failure.
- New and existing signed-in players with undecided browser permission receive
  one dedicated step before play. Its single Continue action supplies the user
  gesture required by Android browsers and opens the real browser permission
  request. There is no ChessRiot-level Not now bypass before that attempt.
- A granted result completes account-level push registration. A blocked,
  dismissed, or failed result never triggers another automatic request on that
  browser, while the global Settings control remains available for a deliberate
  manual retry or recovery after browser settings change.
- The account records setup as pending immediately after Allow and resumes
  service-worker subscription and server registration after a reload or crash,
  without opening the browser permission request again. Supported browsers use
  an origin-wide Web Lock so simultaneous tabs converge on the same one-time
  attempt; the device marker remains the fallback where Web Locks are absent.

## v0.26.0 release additions

- Mobile notification consent is one explicit account-level choice per device.
  New accounts see it after username onboarding; existing accounts see the same
  normal inline card once on `/` or `/app`. It never renders on `/g/*`, covers a
  board, or invokes the browser permission prompt without an Enable click.
- Settings exposes one global **ChessRiot notifications · This device** toggle.
  Enabling registers the origin PushSubscription to the signed-in account and
  covers existing and future multiplayer games. Sign-out detaches and
  unsubscribes that browser device; enabling another account transfers the
  endpoint explicitly.
- Existing per-game subscription rows retain their narrow consent. They are not
  widened automatically. Explicit account-level opt-in replaces only legacy
  rows for that same browser endpoint, preventing duplicate turn alerts.
- Opponent moves queue one idempotent encrypted alert per enabled account device
  in the same mutation batch. Solo, waiting, completed, superseded, and
  idempotent move retries do not create alerts. Legacy and account delivery
  queues share stale-endpoint cleanup and bounded retry handling.
- Control can inspect one exact username in one exact environment, returning
  only active device count and last push-service acceptance. The owner can send
  a bounded 1–120 character service/test body with fixed `ChessRiot` title and
  `/app` destination. There is no broadcast, arbitrary title, or arbitrary URL.
- Each send uses a target-and-message-bound `push-notifications:manage` grant and
  a D1-consumed nonce, plus per-player and global hourly limits. Production
  requires a second owner confirmation. Results say accepted by the push
  service, never delivered or read; logs omit usernames, bodies, endpoints,
  keys, and provider identifiers. Marketing requires separate consent and is
  outside this release.

## v0.25.4 release corrections

- Android turn alerts remain an explicit, per-game PWA opt-in. Each active game
  can show one small bell badge on Settings until its alert offer is opened or
  enabled, but the offer never overlays the board.
- OpenAI authentication and project-permission failures use distinct stable
  operational codes, so Production can distinguish a rejected key from a key
  that lacks compiler access without exposing provider text to players.
- Magic setup says a normalized prompt is ready to be checked, not already
  understood. Unsupported mechanics such as teleportation are rejected before
  a World is created once the compiler connection is healthy.

## v0.25.3 release correction

- After hosting migrations complete, the first root-page request initializes
  the environment's storage epoch and external continuity mirror in background
  work. Control can therefore read a stable version and health result on a cold
  release without waiting for a player to make an authenticated API request.
- `/api/health` remains strictly read-only. A real D1 swap, object-storage
  mismatch, environment mismatch, or account-identity-secret change still
  prevents normal API initialization and produces an operational error.

## v0.25.2 release corrections

- An active multiplayer move and every eligible opponent-turn delivery intent
  commit in one D1 transaction. Delivery workers lease due rows, revalidate the
  exact active game version and target turn, and retry transient network, 429,
  and 5xx failures with bounded backoff. One short retry runs without unrelated
  traffic; later due rows remain durable for the scheduled worker. Sent rows are
  never reclaimed.
- Android notifications use a privacy-safe opaque Web Push topic. A matching
  game clears an existing notice only after its authoritative snapshot is
  visible, and a notification tap prefers the exact game client with a safe
  new-window fallback. Merely focusing a stale tab never suppresses or clears
  an opponent-turn notice.
- Expired or completed-game subscriptions are removed and delivery records are
  retained for 30 days. Cryptographic VAPID validation is shared by the config
  and health routes so an incomplete or mismatched key pair cannot appear ready.
- A newly interpreted rule remains an internal compiled staging record until
  the canonical World, source, and paid game entitlement commit. A successful
  Apply Magic response therefore always contains a persistent canonical World.
- Compiler failures have stable, player-safe classes for invalid rules,
  unsupported rules, ambiguity, connectivity, timeout, provider rejection,
  provider rate limiting, configuration, and temporary service outage. The UI
  never exposes raw gateway or provider text and states whether a credit was
  refunded or the exact idempotent request remains recoverable.
- Paid compiler requests have a fixed output ceiling, hourly and daily account
  and environment budgets, negative caching for deterministic semantic
  rejections, and a shared failure circuit. Refunded provider failures cannot
  be used as an unbounded token-spend path.
- Every database receives one permanent storage epoch and an account-identity
  marker derived from its environment and identity secret, mirrored into the
  environment's separately bound object storage. A later database swap, secret
  change, or environment mismatch fails closed instead of silently mapping the
  same Google user to a new account and losing feature access.
- Health now requires the Magic approval, push subscription, push delivery, and
  runtime-invariant tables, performs no schema or telemetry writes, and exposes
  only the non-sensitive storage epoch for deployment continuity checks.
- The tutorial knight step accepts the highlighted knight destination directly
  and animates the square actually chosen. Multiplayer setup describes the
  invitation as part of starting a game, labels the waiting-for-acceptance
  state explicitly, and offers accept/decline actions from the game itself.

## v0.25.1 release corrections

- Quick Reactions are removed from the game interface, including the mobile
  React tab, modal panel, polling, notification bubbles, and client handlers.
- Day-based multiplayer games show the authoritative per-move deadline at every
  screen size and do not show separate cumulative live chess clocks. Solo and
  legacy no-deadline games keep their informational clocks.
- Active multiplayer games offer a direct, per-game closed-app Android turn
  alert opt-in. The flow fails closed unless the environment has one
  cryptographically matching VAPID key pair and gives Brave-specific recovery
  guidance when Android push messaging is disabled.

## v0.25.0 release additions

- Permanent usernames accept letters, combining marks, and numbers from every
  writing system, with an initial letter and optional internal ASCII dot,
  hyphen, or underscore separators. Length is 3–20 user-perceived grapheme
  characters, with separate scalar and byte ceilings against combining-mark
  abuse.
- Username display values are NFKC-normalized. Global uniqueness, lookup,
  tombstones, Magic access, and local World drafts all use one shared Unicode
  caseless canonical key. Destructive account-deletion confirmation still
  requires the exact normalized display spelling. Existing ASCII usernames
  keep the same key and behavior.
- Spaces, emoji, controls, bidi overrides, zero-width formatting characters,
  leading, trailing, and repeated separators remain invalid. English reserved
  and high-confidence profanity checks remain in place; player reporting and
  moderation cover language-specific abuse rather than claiming a complete
  global profanity dictionary.
- The permanent-handle form starts empty and uses an ordinary directional text
  keyboard on Android. It opts out of browser credential autofill, keeps
  autocorrect and capitalization off, and no longer carries an ASCII HTML
  pattern or UTF-16 max-length gate.
- Invalid usernames produce visible, announced guidance on blur and submit.
  Taken, reserved, and server-side failures use the same stable error location;
  the submit action remains reachable so a disabled confirmation control can
  never hide the reason.
- Development and Production receive the same immutable v0.25.0 application
  tree. Environment data, access, OAuth clients, secrets, and bindings remain
  isolated.

## v0.24.0 release additions

- Magic Rule entry is empty by default and uses the exact placeholder
  `e.g. Knights move twice`. A separate **Apply Magic** action is required
  before game creation.
- Apply Magic costs one credit and issues an idempotent entitlement bound to
  the exact future game-create request. The game API accepts the resulting
  World code and never invokes the compiler itself. Credit is reserved before
  compilation, identical concurrent requests share one compiler lease, and a
  recoverable local draft retains an interrupted request for exact retry.
- Every new account starts with 10 credits. A qualifying new-player referral
  awards 10 credits. A World creator earns one credit for each five paid games
  in which the paying account makes a legal move. Self-use never qualifies.
- A World is an immutable canonical rule document identified by the first 160
  bits of its SHA-256 digest as `0x` plus 40 lowercase hexadecimal characters.
  The full 256-bit digest is retained as a collision guard. UI uses a compact
  form such as `0xAF1235…9C2D`.
- Prompt wording, language, rule order, legacy representation, compiler model,
  creator, and time are excluded from identity. Semantically equivalent
  compiled rules therefore resolve to the same World and first creator.
- Worlds form a directed acyclic parent-to-fork graph. Signed-in players can
  browse Map, Popular, New, and Mine views, inspect rules and creator, play an
  existing World without recompilation, or fork it with new rules.
- World node size increases logarithmically with games that contain at least
  one human move. Raw prompts are not exposed in World records, routes,
  analytics, invitations, or the public map.
- An active Magic game's World card appears in the desktop sidebar and mobile
  World drawer. It never takes vertical space from the board column.
- ChessRiot's Google-established application session has a sliding one-year
  expiry, renewed at most daily on successful activity. Its original Google
  authentication time remains immutable for recent-auth destructive actions.

## v0.23.1 release addition

- The owner-only analytics endpoint relies on deployed migrations, executes its
  required aggregates in one D1 batch, omits unused daily-series work, and keeps
  time-filter indexes for the account, game, move, social, referral, and
  observability queries used by Control.

## v0.23.0 release additions

- The 30–60 second interaction tutorial is fully opt-in. New accounts default
  to a settled state, legacy pending state never opens a modal, and the player
  may explicitly start or repeat the tutorial from Settings. Step changes move
  focus and announce progress; reduced-motion mode removes delayed transitions.
- Public homepage links to the current 90-second video are removed, `/demo` is
  excluded from discovery and marked noindex, and the direct QA route plus its
  bounded owner-only regeneration pipeline remain available for a future
  replacement. This supersedes the public-link requirement recorded in v0.11.0.
- Account, signed-home, and initial game reads use bounded backoff, a read
  timeout, one coalesced in-flight request, and immediate online, focus, and
  visible-tab recovery. A game `401` invalidates the account session instead of
  masquerading as missing game access. Moves, resignations, draws, reactions,
  and other mutations are never retried automatically.
- Save-Data and `slow-2g`/`2g` connections reduce active-game and reaction
  polling from three to nine seconds while preserving immediate reconnect
  checks and authoritative post-mutation reads. Low-resource presentation drops
  decorative animation, backdrop filtering, and costly shadows without hiding
  controls or content.
- Global keyboard navigation gains a visible skip link and main landmark.
  Forced-colors, focus visibility, coarse-pointer target size, and contrast are
  strengthened. Whole-second player clocks pause rendering in a hidden tab and
  catch up from the monotonic clock when visible again.
- Either participant in a completed game may create one idempotent, opaque,
  rate-limited recap link through a same-origin authenticated request. The
  public noindex recap exposes only usernames, result, variant, initial
  position, and immutable moves in a read-only replay. It never exposes seat
  capabilities, invite credentials, account identifiers, or mutation access.
- A participant may revoke the current recap. Recreating it produces a new
  opaque link, and permanent account deletion revokes every recap involving
  that account before memberships are anonymized.
- The privacy-safe analytics contract adds a mature signup journey: accounts
  created from 24 hours to seven days ago, with username, game-start, and first
  legal move counted only when reached within 24 hours of signup. Only aggregate
  stage counts, timestamps, environment version, and median time are returned.
- ChessRiot Control v0.13.0 automatically refreshes separate Dev and Production
  journey cards on its existing five-minute cycle, reports Learning below ten
  mature accounts, applies documented Healthy/Watch/Action thresholds after
  that, and keeps the release pipeline first while grouping supporting tools as
  Launch, Players, Operations, and Maintenance.

## v0.22.0 release additions

- A signed-in player who sees the locked Magic Rules card may send one
  idempotent invitation request. The card immediately becomes a durable
  Requested state and never implies that access has already been granted.
- Requests are environment-local, rate-limited, exportable with account data,
  deleted with the account, and accept only the server allowlisted
  `magic_rules` feature key.
- ChessRiot Control v0.12.0 adds a top-level key notification with an exact red
  count and a right-side Dev/Production queue. The owner may approve or dismiss
  one opaque request at a time; unavailable environments remain explicit.
- Approval atomically enables the existing server-side feature flag and removes
  the request. Replay, cross-origin use, arbitrary usernames, and arbitrary
  feature keys fail closed. Dismissal removes only the request and grants no
  access.
- Manual Magic Rules enablement clears a stale pending request for that account,
  while manual disablement lets the player request access again later.

## v0.21.1 release hardening

- Escape persists the same durable Skip decision as the tutorial control; a
  failed write keeps the modal visible with a retry message.
- Privacy exports keyset-paginate every game and move and include an explicit
  completeness summary.
- Every API request schedules a retention sweep. Product events stop
  contributing after 30 days, moderation archives are hidden at their expiry,
  and both are physically removed by the next service request.

## v0.21.0 release additions

- New accounts enter a skippable three-step tutorial designed for roughly
  45 seconds. Completion or skip state persists on the account, Settings can
  replay it, and failed persistence keeps the tutorial open for retry.
- The signed-in dashboard includes an Activity inbox for friend requests,
  direct challenges, current turns, and recent results. Unread state is durable,
  snapshot-based, block-aware, and never presents a settled request as active.
- Player safety covers outgoing-request cancellation, friend removal,
  bidirectional block enforcement, unblock management, bounded report reasons,
  optional report notes, deduplication, and report-and-block feedback. A
  separately scoped owner-only Control queue can review or close reports, and
  deletion-related moderation copies expire after 90 days.
- `/privacy-center` provides a safe JSON export, blocked-player management, and
  permanent deletion guarded by recent Google reauthentication plus exact
  username confirmation. Deletion reserves the username, prevents silent
  account recreation, revokes active access, cancels unfinished games, and
  anonymizes surviving records.
- `/api/ops/analytics` exposes only environment-local aggregates for discovery,
  onboarding, activation, engagement, and quality. It returns no player, game,
  route, request, or hash identifiers and never joins Dev and Production.
- ChessRiot Control v0.11.0 adds a collapsed Analytics center with separate Dev
  and Production views, 7- and 30-day windows, honest unavailable states, and no
  sample or fabricated zero data, plus a separately authorized Safety queue.
- The signed-out 90-second video moves to story recipe v4. It accurately shows
  required Google accounts, permanent usernames, tutorial, Activity, friends,
  one-screen play, History, privacy controls, and gated Magic Rules; native WebVTT
  captions and a post-video sign-in CTA are always available.
- Google Analytics 4 and Hotjar remain explicitly deferred high-priority launch
  integrations. Neither third-party script is included in this release.

## v0.20.0 release additions

- Each registered player receives one stable personal invite link, visible beside Friends and shareable through the platform share sheet or clipboard fallback.
- A qualifying referral is reserved only when the signed Google callback creates a genuinely new account from that invite. Completing the permanent username awards the inviter 10 non-transferable credits and connects both accounts as accepted friends in one transaction. This supersedes the original 100-credit reward.
- Referral attribution is first-touch, once per referred account, rejects self-referral, and never awards an existing account. Replays remain idempotent and report zero newly awarded credits.
- Selected History filters suppress the inherited label shadow so their text remains crisp against the gold selected state.

## v0.19.0 release additions

- A valid Google session is required before a player may create, join, read, or
  mutate a game. Public marketing, demo, changelog, Privacy, and Terms routes
  remain signed-out surfaces. Private seat and invitation tokens select an
  offered seat but no longer authorize guest play. This supersedes the
  optional-account behavior recorded for v0.18.0 and v0.18.1 and in ADR 0005.
- The first successful Google login requires one globally unique username.
  It is immutable after confirmation, 3–20 characters, begins with an English
  letter, uses only English letters, numbers, dots, hyphens, or underscores,
  compares case-insensitively, and rejects reserved or profane forms. The
  v0.25.0 Unicode username profile supersedes this original alphabet limit.
- Signed-in users receive a dedicated dashboard with current games, incoming
  and outgoing friend requests, accepted friends, and direct links to complete
  account history. The public homepage remains a separate signed-out pitch.
- A player may find another account by exact username, send one idempotent
  friend request, and accept or decline an incoming request. Accepted friends
  can be selected from new-game setup for an immediate configured challenge;
  the private-link invitation path remains available for another registered
  player.
- Active and completed games are associated with the Google account
  automatically. The paginated history supports mode, variant, and Magic
  filters and does not depend on browser-local discovery.
- Magic Rules remain Coming Soon for ordinary accounts. An owner-only Control
  grant manages an environment-local, server-side username whitelist. Only an
  enabled account may create a new Magic game, supported prompts compile to a
  bounded deterministic rules document, and unsupported prompts fail closed.
  Existing Magic games remain readable and playable by their participants.
- The active game keeps the board, players, turn status, and primary controls
  within one common desktop/laptop viewport at 100% zoom. v0.25.1 hides the
  informational live clocks in day-based multiplayer games and keeps the
  authoritative deadline visible instead.
- ChessRiot now ships 12 original skins, adding Mythic Beasts. Every skin keeps
  a distinct, richer procedural arrangement and themed sound profile. Settings
  exposes separate persistent volume controls for music and sound effects, and
  every boolean preference uses a native checkbox in an icon-led section.
- Legal and capture targets render above all piece artwork. Homepage pieces
  animate between exact square centers and reset out of view. Capture,
  promotion, game-end, and postgame presentation remain decorative,
  reduced-motion-safe, and non-blocking.
- Privacy and Terms stay public for provider and legal use but are linked
  subtly from sign-in and username onboarding rather than the public homepage.
- Development and Production use the same immutable v0.19.0 application tree.
  Their data, domains, access gates, OAuth clients, secrets, and feature
  whitelists remain isolated; Production still advances only by explicit owner
  promotion of the verified Development release.

The release sections below are retained as historical records. Where they
conflict with v0.19.0, the v0.19.0 contract and ADR 0006 govern current
behavior.

## v0.18.1 release corrections

- An exact private-seat token takes precedence over ambient Google or Sites
  memberships, so opening a specific seat link cannot resolve to the other
  seat.
- Concurrent guest-membership creation, Google linking, and idempotent game
  retries settle on the persisted owner without a transient authorization
  failure.
- Protected Development users retain legacy Sites-only recent-game discovery
  even when they have not signed in with Google.

## v0.18.0 release additions

- Google sign-in is optional and adds cross-device account access. Exact
  private-seat links continue to support guest create, join, open, and play.
  Public, demo, changelog, Privacy, and Terms routes remain identity-independent.
- The server uses OAuth 2.0 Authorization Code with PKCE and OpenID Connect.
  It binds a short-lived signed transaction to 256-bit state, nonce, and code
  verifier values, exchanges the code server-side, and validates Google's JWT
  signature, issuer, audience, expiry, nonce, and verified-email claim.
- OAuth callbacks are exact and environment-specific:
  `https://dev.chessriot.gg/api/auth/google/callback` for Development and
  `https://chessriot.gg/api/auth/google/callback` for Production. A login begun
  on a provider alias first returns to the canonical custom hostname so its
  host-only transaction cookie reaches the callback.
- Development keeps the existing Sites user allowlist. Google returns through
  the admitted tester's browser, so neither the callback nor the rest of Dev is
  opened publicly. Production's `/privacy` and `/terms` are the public legal
  URLs used for Google Branding.
- Durable identity derives from a versioned HMAC of Google's stable `sub`, not
  email. ChessRiot stores the pseudonymous account ID and normalized display
  name, but no raw Google subject, email, access token, refresh token, or ID
  token. The signed HTTP-only session is Secure, SameSite=Lax, host-only, and
  slides for one year with bounded renewal; sign-out immediately removes
  account-only access.
- A signed-in create or join writes the Google account membership. An older
  guest seat migrates only after the user explicitly chooses to add it to the
  account and supplies the matching 256-bit seat token. Ordinary game loads do
  not change ownership. The explicit action moves only that seat and its push
  associations, never when a non-guest owns it or the account owns the other
  color. Browser guest identity is not authority to bulk-link games.
- `/api/me/games` feeds the signed-in recent-game list across devices and is
  merged with local private-link history. Exact private links remain
  independent, game-specific guest authorization.
- `/privacy` and `/terms` are identity-independent application routes in both
  builds, linked from the public shell and Settings and included in crawler
  metadata. Dev's outer Sites gate still protects its copies.
- Development and Production select only `OPENAI_API_KEY_DEV` and
  `OPENAI_API_KEY_PROD`, respectively. One owner-authorized fixed-marker smoke
  action reserves at most one provider attempt per release and environment.
  One opt-in live suite test can make the same minimal Responses API call under
  explicit operator control, with no player or game data and no default CI spend.

## v0.17.0 release additions

- The persisted skin is applied by an inline allowlisted bootstrap before the
  first paint on every route. It changes the public shell, setup flow, menus,
  board, pieces, cards, music, and visual effects, and synchronizes across tabs.
- A single fixed Settings launcher replaces the competing version, sound,
  theme, feedback, and game-tools entry points. Its grouped controls cover
  appearance, audio, play assistance, current-game actions, feedback, install,
  privacy, community, and the exact release version.
- Sound effects and music are independent, default-on preferences with one
  persistent master volume. Each skin uses its own restrained procedural music
  treatment. Check, castling, queen capture, promotion choice, result, and
  invalid action have classified sound and visual treatments without network
  or media-file dependencies.
- Capture combat lasts approximately one second and remains distinct for pawn,
  knight, bishop, rook, queen, and king. It is decorative, pointer-transparent,
  and never delays optimistic rendering, server submission, or the next legal
  interaction. Reduced-motion mode suppresses nonessential movement.
- The separate replay dialog and More panel are removed. The game sidebar keeps
  one compact row for the currently viewed move and expands through a standard
  disclosure control into the complete move table. Capture rows carry a sword
  marker. A second always-visible panel lists every captured piece by captor.
- A confirmed resignation starts a theme-aware white-flag king finisher only
  after the server accepts the action. Waiting games continue to cancel without
  presenting a false resignation.
- The default-on Chess Coach is a deterministic local guard for obvious
  immediate material loss. It asks whether to continue and reveals one short
  explanation only on request. It never uses an LLM, changes legal moves, or
  sends position data off-device. Fork celebrations are also local, small, and
  independently optional.
- New Magic prompts fail closed with a stable unavailable error. Exact
  idempotent retries for existing legacy Magic games and all stored-game reads
  and moves remain compatible.
- JSON request bodies are bounded while streaming, health checks verify the
  real schema and required hosted configuration, privacy-safe observability no
  longer falls back to unsalted identifiers, and hosted responses add safe
  baseline security headers.
- The repository pins the runtime/toolchain, has a reproducible full build
  gate, validates packaged bindings and migrations, audits dependencies, and
  runs pull-request CI with an SBOM artifact.

## v0.16.0 release additions

- Pawn, knight, bishop, rook, queen, and king captures each use a distinct
  physical action. The captured piece reacts before the impact layer clears.
- The combat layer is presentation-only and pointer-transparent. The same
  immediate optimistic board remains underneath for Multiplayer, Solo, and
  Riot Bot actions; animation never disables squares, changes `aria-busy`, or
  delays a legal next interaction.
- Effects are reconstructed from immutable FEN history, including en passant,
  capture promotion, and both legs of an atomic Magic move. Initial load,
  refresh, unchanged polling, rollback, history, reduced motion, and a hidden
  tab never replay stale combat.
- `/capture-lab` renders the production combat component for all six attackers
  and its reduced-motion state.
- Create Game, Join Game, and Feedback share one required-text presentation
  pattern. A blank or whitespace-only submission keeps the action available,
  turns the exact field red, announces a specific inline message, connects it
  through ARIA, and focuses the first invalid field. The error clears as soon
  as the value becomes valid.

## v0.15.0 release additions

- Multiplayer and Solo both paint a locally legal human move immediately while
  the authoritative request is in flight. Input stays guarded until the server
  accepts or rejects the move, and a rejection reconciles to server state.
- The transient `LOCKING MOVE` label is removed. Network latency must not delay
  the piece's visible movement.
- Active games show one version link in the game header. The global route
  version is suppressed there so no duplicate label can overlap the board, and
  the game-header version remains available on mobile.
- The game menu adds a Solo-only Mating Set. The learner is always White
  against Riot Bot's lone king in King + Pawn, King + Rook, and King + Two
  Bishops setups.
- Mating Set positions are immutable server presets. Normal legal moves,
  promotion, checkmate, draw detection, history, replay, and Riot Bot behavior
  remain server-authoritative. A Multiplayer request for one is rejected.
- ChessRiot now has two active hosted environments, Development and
  Production. Production advances only by an explicit manual promotion of the
  exact tested Development release.

## v0.14.0 release additions

- New-game setup keeps Classic Chess selected by default and adds a compact
  game menu with three Mini Games: Pawn Riot, Half Army, and Pawn Duel.
- Each Mini Game is an immutable, server-owned starting-position preset. The
  client sends only an allowlisted variant id and can never provide a FEN.
- Every preset works in both Solo and Multiplayer. Normal chess moves,
  promotion, check, checkmate, draws, history, replay, deadlines, and Riot Bot
  behavior remain server-authoritative.
- The selected game is disclosed in the invitation preview, active-game
  banner, Game Info, and the current device's recent-game cards.
- Standard remains the default for legacy rows and callers that omit a variant.
  Mini Games cannot combine with Magic Rules in this first release.
- Literal kingless pawn chess remains outside this release because it requires
  a separate legal-move and victory-condition engine. Pawn Riot and Pawn Duel
  preserve one king per side and use normal checkmate rules.

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
  not advance during CPU work. Immediate mate is selected before deeper search,
  and the strongest level remains inside the tested Worker request budget.

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
- At that release, visual themes loaded only on active `/g/*` routes. v0.17.0
  supersedes this behavior with a whole-app, pre-paint skin.
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
- At that release, a small global version link was visible across routes.
  v0.17.0 moves it into the unified Settings menu.
- Active joined multiplayer games expose six safe preset cheers. For 15 minutes
  after completion, only Good Game and Thanks remain available; bounded history
  stays readable afterward. Cheers are authenticated, idempotent, rate-limited,
  and never allow free-form chat.
- Multiplayer creation offers one, three, or five days per move, defaulting to
  three. An expired turn ends the game with the side that missed its move as
  the loser. Legacy games without a stored pace keep no deadline.
- At that release, every game exposed a separate read-only replay dialog.
  v0.17.0 replaces it with the expandable side-panel move table while keeping
  live-board history read-only.
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
2. ChessRiot requires Google sign-in. A first-time user claims and explicitly
   confirms one permanent username before any play route opens.
3. Returning users land on their account dashboard, where games, history,
   friends, and pending requests load from the server.
4. The player may start Solo, send or answer a username-based friend request,
   challenge an accepted friend, or create a registered-player invitation.
5. Solo reveals a five-step Bot level bar that starts at Level 3, Medium. Colors
   are assigned evenly and deterministically from the idempotent create request.
   If Riot Bot is White, its legal opening is committed before the game appears.
6. Multiplayer asks for a one, three, or five-day move pace. A direct friend
   challenge reserves the opponent account and starts only after that friend
   accepts it; otherwise the game emits a one-use invitation that another
   signed-in player can claim.
7. Ordinary accounts see Magic Rules as locked early access and may request one
   invitation. A whitelisted account may opt into a supported deterministic
   Magic ruleset for a Standard game.
8. Every human and computer move is revalidated by the server against
   authoritative history. The board polls for changes and refreshes on focus.
9. The dashboard and paginated history restore every account game on any
   signed-in device without relying on browser-local discovery.

## Rules and persistence

- Standard chess is the default new-game option, implemented with chess.js.
  Whitelisted accounts may create a Standard-board game with a supported,
  deterministically compiled Magic document. Stored rules remain immutable.
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

- Google OpenID Connect establishes the required ChessRiot account session.
  OAuth transactions use PKCE, signed state, nonce validation, exact canonical
  callbacks, Secure host-only HTTP-only cookies, and isolated environment
  credentials. Provider access, refresh, and ID tokens are never persisted.
- D1 stores a pseudonymous account identifier derived from Google's stable
  subject, plus the immutable username as a separate profile field. Raw Google
  subject and email are not stored as profile identifiers.
- A game membership authorizes exactly one color and prevents one account from
  owning both seats. Private seat and invitation tokens are 256-bit,
  fragment-carried selectors whose SHA-256 hashes are stored server-side, but a
  valid Google session is always required before they may be used.
- URL fragments are never sent in HTTP requests or referrers. Invitation links
  remain one-use, may be reviewed only behind account authentication, and
  require the correct invite token to claim.
- Username lookup is exact and does not expose provider email. Friend, game,
  and username writes receive account-scoped fixed-window limits. Riot Bot work
  keeps its per-game/version lease. No CAPTCHA is used.

## Interface

- Twelve original skins cover the whole application before paint. The default
  Riot skin uses flat teal, slate, warm ivory, and gold. Six skins include
  generated, wholly original illustrations. Every skin keeps the same front-on
  2D board structure and original vector piece silhouettes. None copy
  third-party game branding or assets.
- One icon-led Settings menu owns appearance, separate sound-effect and music
  volumes, coach, tactical celebrations, move confirmation, turn alerts,
  surrender/cancel, feedback, install, community, updates, and version
  information. Every on/off setting uses a native checkbox.
- Drag and drop a piece, or tap/click a piece and then a legal destination.
- Board rotates for Black while submitted coordinates remain absolute chess squares.
- The interface shows explicit player colors, turn, check, the checked king,
  every captured piece, outcome, deadline, Magic Rules, the currently viewed
  move, and an expandable complete read-only move table. Cumulative clocks are
  shown only for Solo and legacy no-deadline games. The board and primary live
  state fit one common desktop/laptop viewport at 100% zoom.
- When a threefold or fifty-move draw is available to the player on move, the interface offers an explicit claim.
- Rich procedural skin-specific arrangements and synthesized move, capture,
  check, castle, queen-loss, promotion, result, and invalid-action sounds are
  on by default. Music and sound effects have separate toggles and persistent
  volume controls.
- Initial loads, refreshes, repeated polling responses, and join-only version changes do not replay move sounds.

## Observability

- Every important API action is recorded as a structured, privacy-safe event in that environment's isolated D1 database.
- Events carry environment, app version, request id, normalized route, result, latency, safe metadata, and an environment-local HMAC reference for the game.
- Unchanged three-second polls are excluded. Events are retained for 30 days with a hard cap.
- Never record player names, bearer keys, key hashes, invitation or private links, fragments, IP addresses, user agents, FENs, raw bodies, or arbitrary exception messages.
- Reaction events record only the selected preset key. Reaction reads are
  excluded from telemetry just like unchanged game polling.
- The owner-only control panel uses two-minute, environment-specific signed
  grants and shows each environment separately. Read grants cannot mutate
  feedback; a distinct `feedback:manage` grant can only perform feedback-close
  actions through the idempotent owner endpoint.
- A distinct `feature-flags:manage` grant lists and changes the environment's
  Magic Rules username whitelist. Feature checks remain server-side on new-game
  creation and never trust a client-only toggle.
- A separate `feature-access-requests:manage` grant lists, approves, or dismisses
  one environment's pending Magic Rules requests. Approval is keyed by an
  opaque request id and never accepts a browser-supplied username.
- The operations overview reports exact feedback totals and unresolved counts
  independently of its bounded item list. `new` and `reviewed` feedback are
  unresolved; `closed` feedback is done. Unresolved items are returned first.
  Failed reads remain visibly stale and never become fake zeroes.
