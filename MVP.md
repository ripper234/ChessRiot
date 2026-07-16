# ChessRiot MVP

## MVP outcome

Deliver the smallest useful mobile-first web MVP: asynchronous standard chess between known users with Google login, friends, persistent move history, and turn notifications.

## Included

1. Project foundation deployable to Vercel with a Node runtime.
2. Google login and required username onboarding.
3. Friend lookup by exact username or exact email.
4. Friend request, accept, decline, and friend list.
5. Async game invite between friends.
6. Turn pace selection: 1, 3, or 5 days per move.
7. Standard chess legal move validation.
8. Server-authoritative game state and immutable move history.
9. Active games, game detail, move history, and completed game history.
10. In-app turn notifications and email turn notifications.
11. Acceptance tests for the behavior in `TEST_FLOWS.md`.

## Excluded

- Coach.
- Animations.
- Powers, variants, chaos mode, or balanced mode.
- Matchmaking.
- Real-time multiplayer.
- Skins, points, rewards, stores, or monetization.
- Public profiles.
- Open chat.
- Native Android or app-store release.

## Success criteria

- Two separate Google accounts can become friends and complete a legal standard chess game asynchronously.
- Illegal moves, stale moves, and wrong-turn moves are rejected by the server.
- The complete move history persists after refresh and after sign-out/sign-in.
- The next player receives an in-app notification and an email notification after every legal move.
