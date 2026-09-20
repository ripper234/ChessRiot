# MVP scope

## Included

- Human versus human asynchronous chess
- Solo chess against Riot Bot with five levels
- Mandatory Google sign-in for every create, join, game read, and game action
- One-time immutable username onboarding with a globally unique, moderated
  3–20 character identifier using letters and numbers from any writing system
- A distinct public homepage for signed-out visitors and an account dashboard
  for signed-in players
- An optional, skippable 30–60 second tutorial launched explicitly from Settings
- A durable Activity inbox for requests, challenges, turns, and results
- Username-based friend requests, accept/decline controls, friend lists, and
  direct configured challenges that the invited friend can accept or decline
- Request cancellation, friend removal, bidirectional blocking, unblock
  management, and bounded private player reports
- Private invitation links that still require the recipient to register or
  sign in before claiming a seat
- Account-backed active and completed game history across devices
- Revocable, opaque public recap links for completed games, with read-only
  move-by-move replay and no seat or account capabilities
- Two separate devices or browsers
- Create, invite, and join
- Standard legal rules and complete endings by default
- A server-owned Mini Games menu with Pawn Riot, Half Army, and Pawn Duel
  starting setups in both Solo and Multiplayer
- A Solo-only Mating Set with King + Pawn, King + Rook, and King + Two Bishops
  against a lone Riot Bot king, with the learner fixed as White
- A visible locked Magic Rules state for ordinary accounts, with an idempotent
  invite request and supported deterministic rule entry enabled only by an
  owner-managed server whitelist
- Empty-by-default Magic entry with explicit **Apply Magic** for enabled
  accounts. Apply costs one credit, compiles once, and creates or reuses an
  immutable wallet-style World code.
- A connected World browser with creator attribution, fork lineage, and node
  size based on games containing at least one human move. Equivalent compiled
  semantics share one World even when the source phrase or language differs.
- Ten starter credits per account, ten per qualifying referral, and one creator
  royalty credit per five paid games where the paying account makes a legal move.
- World rules in the desktop game sidebar and mobile World drawer, without
  reducing the board column.
- Durable game state and move history
- Compatibility with existing private-seat links after required Google sign-in;
  a private token selects a seat but never replaces account authentication
- Turn enforcement and stale-write protection
- Bounded, coalesced automatic recovery for failed account and game reads,
  without automatic mutation retries
- A selectable one, three, or five-day multiplayer move deadline shown as the
  active countdown, without a separate live chess clock
- Mobile-friendly original flat 2D board and piece interface, with a one-screen
  active-game layout on common desktop and laptop viewports
- Twelve original, locally persistent skins, including Mythic Beasts and six
  illustrated backgrounds, applied before paint across public, setup, menu,
  and game views
- One icon-led Settings menu with appearance, audio, assistance, game actions,
  feedback, updates, community, and an unobtrusive exact version; boolean
  preferences use checkboxes
- A collapsible full move-history side panel plus live-board Back and Forward
  controls, with capture markers and a complete captured-piece panel
- An opt-in, browser-local confirmation before every human move
- A short reduced-motion-safe checkmate finisher
- Installable online PWA metadata and subtle release updates
- One optional notification offer per retained site and browser/device profile
  during signed-in entry, with **Enable notifications** and **Not now** always
  available, fail-open background setup, stage-specific manual Settings
  recovery, and visible legacy per-game consent preserved until explicitly
  changed. Eligible incomplete setup has a dismissible recovery control above
  content; a browser-level Android block stays prominent until the player
  rechecks permission. Notices never overlay the board. Eligible opponent-turn and friend-request
  deliveries receive an immediate attempt and up to two bounded request-time
  retries, with first attempts ahead of retries and each row's durable eligibility
  respected; later retries resume on subsequent non-health API traffic
- Pointer and touch drag-and-drop with tap, click, and keyboard fallback
- A visible keyboard skip link, forced-colors support, strong focus states,
  coarse-pointer targets, and Save-Data/slow-link presentation and polling
- Rich, default-on, compositionally distinct skin-specific music plus themed
  game sounds, each with its own toggle and persistent volume control
- A default-on, non-LLM local coach for obvious immediate material losses and
  independently toggleable tactical fork celebrations
- Piece-specific capture sequences, clear move/capture targets,
  check/castle/queen-loss/promotion effects, improved postgame presentation,
  and a white-flag resignation finisher, all reduced-motion safe
- Privacy-safe Development and Production logging and owner control-panel
  observability, including an aggregate launch Analytics center and an exact
  environment-isolated feature-access request queue
- Self-service data export, block management, and recently reauthenticated
  permanent account deletion with username reservation and anonymization
- Public Privacy and Terms pages, including current Google and OpenAI data use,
  linked unobtrusively from account registration rather than the homepage
- One owner-authorized, fixed-marker LLM smoke action and one opt-in tiny live
  test for verifying each environment's isolated OpenAI key
- One owner-authorized Control action to inspect an exact player’s notification
  device count and send a bounded, single-use, high-urgency service/test message
  to that player while requesting persistent mobile presentation
- One exact-device diagnostic that separately reports local browser
  registration, push-provider acceptance, and service-worker receipt without
  claiming that an operating-system banner was visible
- Readable player colors, captured pieces, explicit check guidance, resignation,
  waiting-game cancellation, and separate new games

## Excluded

- Username editing, broader profile editing, and multi-account switching
- LLM or multi-ply AI coach
- Email notifications and real-time transport
- Matchmaking, ratings, points, rewards, and payments
- Free-form chat
- Collectible skins or account-bound cosmetics
- Native apps and app-store packaging
- Arbitrary executable rule code or silently interpreted unsupported prompts
- Magic access for accounts not enabled by the owner whitelist
- Telegram release announcements
- Guest play or private-seat-only access
- Google Analytics, Hotjar, session replay, or third-party advertising trackers


### One-phone notification verification

A player can open `/notification-test` on the Android to test, enable push, and
complete four guided real turns against Riot Bot. Each bot reply arrives after
an eight-second delay, targets only that device, and opens the exact game.
The phone records background/closed-window evidence and notification taps across
page closure. Provider acceptance alone does not pass a round; the player must
return through the notification and confirm seeing it. No second account or
second device is needed. The test is available from Settings and New game.
