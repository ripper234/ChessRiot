# ChessRiot SPEC

## Source-of-truth note

This document defines the agreed MVP behavior. The long-term vision remains playful chess with coaching, cosmetics, animations, and variants, but those are backlog features and must not be implemented in MVP milestones unless explicitly requested.

## Product

ChessRiot is a mobile-first web app for asynchronous chess between known users.

## Users and identity

- A user signs in with Google.
- A signed-in user must choose a globally unique username before using the app.
- The app stores the Google subject identifier and email for identity and lookup.
- Email lookup is private: one user can search by another user's exact email, but the app should not browse or expose lists of emails.

## Friends

- Users can find known players by exact username or exact email.
- A user can send a friend request.
- The recipient can accept or decline.
- A game can be started only between accepted friends.

## Games

- MVP games use standard chess only.
- No powers, variants, coach, animations, matchmaking, or real-time play are active in MVP.
- A friend can invite another friend to an asynchronous game.
- The inviter chooses a turn pace of 1, 3, or 5 days per move.
- The invited player accepts or declines.
- White/black assignment is deterministic and stored at game creation. The implementation may use random assignment if both users can see the assignment before the first move.

## Moves

- The server is authoritative for legal move validation.
- The client may preview legal moves, but the server must revalidate every submitted move.
- A submitted move must include the game id, acting user id, move notation, and expected position/version.
- Illegal, wrong-turn, stale-position, or completed-game moves are rejected without changing game state.
- Legal moves append an immutable move record, update current game state, switch turn, update deadline, and enqueue a notification for the next player.

## Persistence

- The app stores current board state, status, turn, move count, and full move history.
- A player can close and reopen the app and resume every active game from the authoritative state.
- Completed games remain visible in game history.

## Notifications

- MVP must notify a player when it becomes their turn.
- In-app notifications are required.
- Email notifications are the recommended MVP external notification channel.
- Web push is deferred unless it is cheaper to implement than email in the selected stack.

## Safety and privacy

- No random matchmaking in MVP.
- No open chat in MVP.
- Friend connections require an explicit accept action.
- Users can only see games and move history for games in which they are a participant.
- Users can only mutate their own profile, friend requests addressed to them, and games where they are the current player.
