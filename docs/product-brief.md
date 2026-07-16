# ChessRiot Product Brief

## Canonical direction

ChessRiot is a mobile-first web app for asynchronous standard chess between people who already know each other. The agreed MVP is intentionally smaller than the long-term playful chess vision.

## MVP promise

Two known players can sign in with Google, choose usernames, become friends, start an asynchronous standard chess game, make legal moves over time, receive turn notifications, and review the persistent move history.

## In scope for MVP

- Mobile-first responsive web app.
- Node-based application deployable on Vercel.
- Google login.
- Required globally unique username.
- Known-user friend flow by username and private email lookup.
- Asynchronous standard chess only.
- Server-authoritative move validation.
- Persistent current game state and full move history.
- Turn pace options of 1, 3, or 5 days per move.
- Notifications when it becomes a player's turn.
- Basic active and completed game lists.

## Explicitly out of MVP

- Coach.
- Animations.
- Powers or variants.
- Matchmaking.
- Real-time play.
- Skins and collectible cosmetics.
- Points and rewards.
- Open chat.
- Native Android build.

## Product guardrails

- Real chess integrity comes first.
- Known users only; no random strangers in MVP.
- No open chat between minors or strangers.
- Do not expose email addresses unless necessary for the current user to recognize their own account.
- Keep future coach, variants, animations, rewards, and skins out of MVP milestones.
