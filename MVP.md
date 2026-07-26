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
- Optional per-game Magic Rules interpreted at runtime into deterministic,
  immutable same-piece sequences of two through six moves and safe action
  filters, with ambiguous or unsupported mechanics rejected
- Durable game state and move history
- Compatibility with existing account memberships and private-seat links
- Turn enforcement and stale-write protection
- A selectable one, three, or five-day multiplayer move deadline
- Mobile-friendly original voxel/block-world interface
- Eleven original, locally persistent game themes, including seven illustrated
  backgrounds, with a textless picker limited to active games
- A visible, exact release version throughout the game app
- Authorized, rate-limited preset cheers for joined two-player games, with a
  15-minute Good Game and Thanks courtesy window after completion
- A read-only, step-by-step replay viewer
- Always-visible Back and Forward history controls on the live board
- An opt-in, browser-local confirmation before every human move
- A short reduced-motion-safe checkmate finisher
- Installable online PWA metadata and subtle release updates
- Pointer and touch drag-and-drop with tap, click, and keyboard fallback
- Optional in-browser game sounds with a persistent mute preference
- Privacy-safe per-environment logging and owner control-panel observability
- Readable player colors, captured pieces, explicit check guidance, resignation,
  waiting-game cancellation, and separate new games

## Excluded

- Social graph, in-app profile editing, and multi-account switching
- AI coach
- Closed-app push, email, and real-time transport
- Matchmaking, ratings, points, rewards, and payments
- Free-form chat
- Collectible skins or account-bound cosmetics
- Native apps and app-store packaging
- Arbitrary executable rule code or silently interpreted unsupported prompts
- Google sign-in and Telegram release announcements until their external
  credentials and explicit feature flags are configured
- Cross-device account history until an account provider is deliberately
  re-enabled
