# ChessRiot Implementation Plan

This plan prepares implementation without writing product code. Milestones are deliberately small and sequential.

## Decisions already resolved

- Build a mobile-first web app, not native Android, for the MVP.
- Use a Node-compatible stack deployable on Vercel.
- MVP is standard chess only.
- MVP is asynchronous known-user play only.
- Google login is required.
- Persistent move history is required.
- Notifications are required, with in-app plus email as the recommended MVP path.
- Coach, animations, powers, matchmaking, real-time play, skins, points, and rewards are backlog only.

## Milestone 0: Resource decision and project hygiene

- Decide whether to reuse or replace the existing `balance-cfa5e3` Supabase project.
- Rotate secrets if reusing any existing managed resource.
- Configure Vercel project and environment variables.
- Confirm Google OAuth callback URLs.

Acceptance checks:

- No unrelated Balance data or secrets are present.
- The selected database is documented as the ChessRiot MVP database.
- Local, preview, and production environment variable names are documented.

## Milestone 1: App shell and auth

- Scaffold the Vercel-deployable Node/TypeScript web app.
- Add Google sign-in.
- Add username onboarding.
- Protect authenticated routes.

Acceptance checks:

- New Google user must choose a unique username.
- Returning user reaches the home screen after refresh.
- Duplicate usernames are rejected.

## Milestone 2: Database schema and authorization

- Create profile, friend, game, move, notification, and email delivery tables.
- Add database constraints for uniqueness and valid statuses.
- Add row-level policies or equivalent server authorization tests.

Acceptance checks:

- Users cannot read games they do not participate in.
- Users cannot create duplicate friendships.
- Move history rows are immutable through normal user access.

## Milestone 3: Friend flow

- Implement exact username/email lookup.
- Implement send, accept, decline friend request.
- Show friend list.

Acceptance checks:

- Accepted friends appear for both users.
- Non-friends cannot start games.
- Partial email browsing is not available.

## Milestone 4: Chess rules adapter

- Add an isolated standard-chess rules module.
- Validate legal/illegal moves.
- Produce FEN, SAN, PGN or equivalent move metadata.
- Cover castling, en passant, promotion, checkmate, stalemate, and draw basics in tests.

Acceptance checks:

- Starting position has the expected legal moves.
- Illegal moves are rejected by the rules module.
- Special standard rules are covered by unit tests.

## Milestone 5: Async game lifecycle

- Create game invites between friends.
- Accept/decline game invites.
- Store player colors, turn pace, current FEN, status, version, and deadlines.

Acceptance checks:

- Friend can invite friend to a 1, 3, or 5 day game.
- Invite recipient can accept or decline.
- Accepted game starts with standard initial position and correct turn owner.

## Milestone 6: Server-authoritative move submission

- Implement move submission as a transaction.
- Revalidate participant, turn, game status, expected version, and legal move server-side.
- Append immutable move row and update game state atomically.

Acceptance checks:

- Legal move updates game and move history.
- Illegal, stale, wrong-turn, and completed-game moves are rejected.
- Duplicate/stale submissions do not create duplicate moves.

## Milestone 7: Game UI and persistence

- Add active games list.
- Add mobile-first board view.
- Add move history view.
- Add completed games list.

Acceptance checks:

- User can refresh and resume from authoritative state.
- Completed game remains readable.
- UI does not expose future coach, animation, powers, matchmaking, or skins as implemented features.

## Milestone 8: Notifications

- Add in-app notification rows for friend requests, game invites, turns, and game completion.
- Add email delivery for turn notifications.
- Track queued/sent/failed email status.

Acceptance checks:

- Legal move creates a `your_turn` notification for the opponent.
- Email notification is queued or sent for the opponent.
- Notification access is limited to the recipient.

## Milestone 9: End-to-end hardening

- Automate acceptance flows from `TEST_FLOWS.md` where practical.
- Run lint, typecheck, unit tests, and relevant end-to-end tests.
- Document remaining limitations and unresolved decisions.

Acceptance checks:

- Two test users can complete the full async loop.
- Authorization tests pass.
- No MVP-excluded feature appears in production navigation as implemented functionality.

## Unresolved decisions requiring approval

1. Reuse cleaned Supabase project or create a fresh ChessRiot Supabase/Neon database.
2. Use Supabase Auth with Google or Auth.js with Google.
3. Email provider for MVP notifications.
4. Whether color assignment is random or inviter choice.
5. Whether exact email lookup should be enabled at launch or username-only until privacy copy is ready.
6. Minimum child/privacy policy requirements before testing with minors.
7. License and contributor policy for public open-source release.
