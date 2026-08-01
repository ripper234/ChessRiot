# MVP scope

## Included

- Human versus human asynchronous chess
- Solo chess against Riot Bot with five levels
- Guest play without sign-in or CAPTCHA
- A fixed public homepage plus a compact create flow at `/app`
- Private-seat authorization and a recent-games list on the current device
- Two separate devices or browsers
- Create, invite, and join
- Standard legal rules and complete endings by default
- A server-owned Mini Games menu with Pawn Riot, Half Army, and Pawn Duel
  starting setups in both Solo and Multiplayer
- A Solo-only Mating Set with King + Pawn, King + Rook, and King + Two Bishops
  against a lone Riot Bot king, with the learner fixed as White
- A visible Magic Rules Coming Soon placeholder, with no new rule entry or
  compilation in the stable release
- Durable game state and move history
- Compatibility with existing account memberships and private-seat links
- Turn enforcement and stale-write protection
- A selectable one, three, or five-day multiplayer move deadline
- Mobile-friendly original flat 2D board and piece interface
- Eleven original, locally persistent skins, including six illustrated
  backgrounds, applied before paint across public, setup, menu, and game views
- One unified Settings menu with appearance, audio, assistance, game actions,
  feedback, updates, privacy, community, and an unobtrusive exact version
- Authorized, rate-limited preset cheers for joined two-player games, with a
  15-minute Good Game and Thanks courtesy window after completion
- A collapsible full move-history side panel plus live-board Back and Forward
  controls, with capture markers and a complete captured-piece panel
- An opt-in, browser-local confirmation before every human move
- A short reduced-motion-safe checkmate finisher
- Installable online PWA metadata and subtle release updates
- Opt-in, per-game closed-app turn notifications for multiplayer seats
- Pointer and touch drag-and-drop with tap, click, and keyboard fallback
- Default-on skin-specific music, independently toggleable game sounds, and a
  persistent master-volume control
- A default-on, non-LLM local coach for obvious immediate material losses and
  independently toggleable tactical fork celebrations
- Piece-specific capture sequences, check/castle/queen-loss/promotion effects,
  and a white-flag resignation finisher, all reduced-motion safe
- Privacy-safe Development and Production logging and owner control-panel
  observability
- Readable player colors, captured pieces, explicit check guidance, resignation,
  waiting-game cancellation, and separate new games

## Excluded

- Social graph, in-app profile editing, and multi-account switching
- LLM or multi-ply AI coach
- Email notifications and real-time transport
- Matchmaking, ratings, points, rewards, and payments
- Free-form chat
- Collectible skins or account-bound cosmetics
- Native apps and app-store packaging
- Arbitrary executable rule code or silently interpreted unsupported prompts
- New Magic Rules until a safe runtime compiler is explicitly approved and merged
- Google sign-in and Telegram release announcements until their external
  credentials and explicit feature flags are configured
- Cross-device account history until an account provider is deliberately
  re-enabled
