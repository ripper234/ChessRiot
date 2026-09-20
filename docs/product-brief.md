# ChessRiot Product Brief

## Current promise

ChessRiot is a mobile-first web app for solo and asynchronous chess. Players
sign in with Google, claim one permanent username, become friends by username,
start configured challenges, make server-validated moves over time, and return
to the same automatic history on any device.

The signed-out homepage introduces the game. The signed-in dashboard centers
the player's current games, friends, requests, and history. A common active
game keeps the board, player state, deadline, and primary controls within one
desktop/laptop viewport while remaining mobile friendly.

## Released experience

- Google account required for play, with one immutable globally unique
  username and no guest fallback.
- Username-based friend requests, accepted-friend challenges with explicit
  accept or decline controls, and registered player invitation links.
- Solo Riot Bot, asynchronous Multiplayer, fixed Mini Games, and Mating Set
  practice, all with server-authoritative rules and immutable history.
- One-, three-, and five-day multiplayer deadlines, without a separate live
  chess clock in day-based games.
- Twelve original whole-app skins, including Mythic Beasts, each with richer
  distinct music, themed effects, and reduced-motion-safe animation.
- A server-side Magic Rules whitelist controlled by the owner. Ordinary users
  see Coming Soon; enabled accounts can create only supported deterministic
  rules.
- Separate sound-effect and music volumes, clear checkbox settings, account
  history, a direct per-game Android turn-alert opt-in, and local move-risk coaching.

## Current exclusions

- Matchmaking, ratings, points, rewards, payments, and collectible ownership.
- Open chat, email notifications, and real-time transport.
- LLM coaching or arbitrary executable Magic code.
- Username changes, multi-account switching, native app packaging, and guest
  play.

## Product guardrails

- Real chess integrity comes first.
- Known users remain the primary multiplayer model; no random matchmaking.
- No open chat between minors or strangers.
- Never expose Google email addresses through friend discovery.
- Keep chess validation server-authoritative even when presentation and Magic
  rules vary.
