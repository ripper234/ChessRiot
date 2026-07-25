# MVP scope

## Included

- Human versus human asynchronous chess
- Solo chess against Riot Bot with five levels
- Sign in with ChatGPT, server-verified CAPTCHA, account-bound game membership,
  and a cross-device game list
- Two separate devices or browsers
- Create, invite, and join
- Standard legal rules and complete endings by default
- Optional per-game Magic Rules for atomic two-step rook or knight turns, no
  promotion, no castling, and no en passant, with unsupported prompts rejected
- Durable game state and move history
- Legacy private-seat migration into account membership
- Turn enforcement and stale-write protection
- A selectable one, three, or five-day multiplayer move deadline
- Mobile-friendly original voxel/block-world interface
- Eleven original, locally persistent visual themes, including seven
  illustrated backgrounds, with a global textless picker
- A visible, exact release version on every route and state
- Authenticated, rate-limited preset cheers for joined two-player games, with a
  15-minute Good Game and Thanks courtesy window after completion
- A read-only, step-by-step replay viewer
- A short reduced-motion-safe checkmate finisher
- Installable online PWA metadata, subtle release updates, and opt-in
  opponent-move notifications while the app remains open
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
