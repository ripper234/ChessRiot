# ChessRiot

ChessRiot is a mobile-first web app for playful asynchronous chess between people who already know each other.

## MVP focus

The first implementation is intentionally small:

- Google login.
- Required username.
- Friend lookup and friend requests.
- Async standard chess between accepted friends.
- Persistent current game state and full move history.
- Turn notifications.
- Node-based app deployable on Vercel.

## Not in the MVP

The larger vision includes coaching, animated captures, skins, powers, variants, points, rewards, real-time play, and native apps. These are backlog features and should not be implemented in MVP milestones unless explicitly requested.

## Source-of-truth docs

- `SPEC.md` defines product behavior.
- `MVP.md` defines first implementation scope.
- `ARCHITECTURE.md` defines the proposed smallest architecture, database model, trust boundaries, and Supabase evaluation.
- `TEST_FLOWS.md` defines acceptance tests.
- `docs/IMPLEMENTATION_PLAN.md` defines sequential implementation milestones.
- `docs/product-brief.md` gives the short product brief.
- `docs/adr/` records architecture decisions.

## Development status

This repository is currently in documentation/planning stage. Do not write product code until the MVP decisions in `docs/IMPLEMENTATION_PLAN.md` are approved.
