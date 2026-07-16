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

Milestone 1 implementation has started with a Next.js/TypeScript app shell, Google OAuth through NextAuth, Prisma persistence, and required unique username onboarding. Later MVP flows (friends, games, chess rules, notifications) remain unimplemented backlog milestones until their phases begin.

## Local development

1. Copy `.env.example` to `.env.local` and fill in a ChessRiot-owned Postgres `DATABASE_URL`, `NEXTAUTH_SECRET`, and Google OAuth credentials.
2. Run `npm install`.
3. Run `npx prisma migrate dev` after the target database is selected.
4. Run `npm run dev` and open `http://localhost:3000`.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
