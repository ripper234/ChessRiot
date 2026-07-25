# ChessRiot

Play the current game at [chessriot.ripper234.chatgpt.site](https://chessriot.ripper234.chatgpt.site).

ChessRiot v0.8.2 is a mobile-first chess game for solo play against Riot Bot or asynchronous play with someone you know.

Found something confusing or have a cool rule request? Use **Feedback** inside
the game or [open a GitHub issue](https://github.com/ripper234/ChessRiot/issues).

See the durable [product backlog](BACKLOG.md) for shipped foundations, blocked
progression work, and features that still need explicit rule design.

## What works

- Open `/app`, enter a display name, then choose Solo or Multiplayer without a
  sign-in or CAPTCHA gate.
- Use an identity-independent public homepage at `/`; saved game themes and
  hosting login state cannot change it.
- Play Riot Bot at one of five levels, starting at Level 3, Medium, as either color. If the bot is White, it opens automatically.
- Create a multiplayer game with one, three, or five days per move, then share one private invitation link. Missing the deadline loses the game.
- Resume recent games on the same device or use a private seat link on another
  device.
- Play complete standard chess with server-authoritative legal move validation.
- Optionally enable Magic Rules for one game. Supported prompts can give the
  same rook or knight a second move in that turn, block promotion, disable
  castling, or disable en passant; unsupported clauses are rejected clearly.
- Persist the board, player names, result, and immutable move history in Cloudflare D1.
- Protect each seat with a private 256-bit bearer secret while preserving
  existing account memberships and older private links.
- Detect check, checkmate, stalemate, castling, en passant, all four promotions, insufficient material, claimable threefold/50-move draws, and automatic fivefold/75-move draws.
- Choose from 11 original visual themes during a game, including seven original illustrated backgrounds, with optional synthesized move, capture, check, and game-ending sounds.
- Drag and drop pieces with mouse or touch, while tap, click, and keyboard input still work. Your legal move appears immediately while Riot Bot thinks, and short move and capture animations make both plies visible.
- See explicit White and Black player cards, captured pieces, a highlighted checked king, and check-specific move guidance.
- Step through any game from the start with a read-only, keyboard-accessible replay viewer.
- See a short checkmate finisher using the actual winning piece, with reduced-motion support.
- End an active game by resignation, cancel a waiting game, or start a separate new game without deleting history.
- Start from one compact new-game screen at `/app`.
- Open a newest-first public changelog from the home screen or any active game.
- Send a titled feedback item without leaving the current flow; each environment stores its own owner-review pool.
- Send one-tap preset cheers during two-player games, plus Good Game or Thanks for 15 minutes after play, without opening unrestricted chat.
- Install the online game as a desktop-style PWA and see a subtle dot for
  unseen releases.
- See the exact release version throughout the game app.
- Inspect privacy-safe, isolated health and activity data for all three environments in the owner control panel.

## Current limits

No arbitrary executable rule prompts, AI coach, closed-app push or email
notifications, free-form chat, friend graph, matchmaking, ratings, rewards,
collectible skins, or payments. Cross-device account history, Google sign-in,
and Telegram release
announcements remain disabled until their external credentials are configured
and the corresponding code is explicitly enabled. Guest-scoped throttles
protect application resources, while volumetric denial-of-service protection
remains the hosting edge’s responsibility.

## Versioning

ChessRiot uses SemVer. Every changed deployment gets a new, higher version and the build rejects an unchanged or inconsistent release number. Patch releases are the default; `0.y.0` marks a coherent new user capability. Version `1.0.0` means two people can create, join, securely resume, receive turn notifications, and finish asynchronous games without developer help.

Prepare releases with `npm run release:patch`, `npm run release:minor`, or `npm run release:major`. The version is updated in one place and displayed in the app footer.

## Deployment policy

- Every changed release goes to Development automatically.
- Development → Staging requires the owner’s explicit Control-panel click.
- Staging → Production requires the owner’s explicit Control-panel click.
- Pushes, merges, tests, successful builds, agents, and schedules never promote
  Staging or Production.
- A promotion reuses the exact tested source state. It never rebuilds different
  source for the target environment.

## Stack

Vinext/React, Cloudflare Workers and D1, TypeScript, and chess.js.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
