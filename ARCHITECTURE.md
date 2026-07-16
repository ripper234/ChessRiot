# ChessRiot Architecture

## Agreed MVP architecture

ChessRiot should use the smallest architecture that satisfies the MVP:

- Mobile-first web app.
- Node-based application deployable on Vercel.
- Server-side API routes or server actions for trusted mutations.
- Postgres database with row-level authorization where supported.
- Google OAuth authentication.
- Email provider for MVP external notifications.
- Isolated chess rules module used by both tests and server mutations.

## Suggested stack

- App: Next.js on Vercel, or an equivalent Vercel-friendly Node framework.
- Language: TypeScript.
- Database: Supabase Postgres if the existing project can be renamed, cleaned, and secured; otherwise create a fresh Supabase or Neon Postgres project.
- Auth: Supabase Auth with Google provider if Supabase is selected; otherwise Auth.js with Google OAuth.
- Chess rules: a pure TypeScript adapter around a standard chess library such as `chess.js`, hidden behind a local interface.
- Notifications: in-app notifications stored in Postgres plus email notifications through a transactional email provider.

## Supabase project evaluation

The existing managed Supabase project named `balance-cfa5e3` should not be used blindly because its name and possible history come from another project context.

Use it only if all of the following are true:

1. It contains no production data, secrets, unrelated tables, or policies from the prior Balance project.
2. It can be renamed or clearly documented as belonging to ChessRiot.
3. Google OAuth redirect URLs can be configured for the ChessRiot Vercel domains.
4. Row Level Security can be enabled and tested for all user-owned tables.
5. Secrets and service-role keys are rotated before implementation.

If any condition fails, create a fresh ChessRiot Supabase project. Supabase is still a strong fit for this MVP because Postgres, Auth, RLS, and simple notification tables map directly to the product needs.

## Minimal modules

- `chess-rules`: pure rules adapter; validates moves and produces next FEN/PGN/SAN metadata.
- `auth`: Google identity, session handling, onboarding completion.
- `profiles`: usernames and safe lookup.
- `friends`: friend requests and accepted relationships.
- `games`: game records, participants, status, turn state, deadlines.
- `moves`: immutable move append and history queries.
- `notifications`: in-app rows and email delivery jobs.
- `ui`: mobile-first screens that call trusted server APIs.

## Trust boundaries

### Trusted

- Server API routes/actions.
- Database constraints, transactions, and row-level policies.
- Server-side chess rules validation.
- Notification worker or server-side email sender.

### Untrusted

- Browser state.
- Client-side legal move previews.
- Submitted move notation, expected position, and game id.
- User-controlled usernames and profile fields.
- Notification subscription details.

## Core invariants

- Never trust the client to decide whether a move is legal.
- A move append and game-state update happen in one transaction.
- A game mutation requires participant membership and current turn ownership.
- Move numbers are unique per game.
- Completed games cannot accept moves.
- Users cannot read games they are not part of.
- Email addresses are not exposed through broad search or lists.

## Database model

### `profiles`

- `id uuid primary key` references auth user id.
- `google_sub text unique not null` when available from auth provider.
- `email citext unique not null`.
- `username citext unique not null`.
- `display_name text`.
- `created_at timestamptz not null`.
- `updated_at timestamptz not null`.

### `friend_requests`

- `id uuid primary key`.
- `requester_id uuid not null references profiles(id)`.
- `recipient_id uuid not null references profiles(id)`.
- `status text not null check in ('pending','accepted','declined','cancelled')`.
- `created_at timestamptz not null`.
- `responded_at timestamptz`.
- Unique pending request per requester/recipient pair.

### `friendships`

- `id uuid primary key`.
- `user_a_id uuid not null references profiles(id)`.
- `user_b_id uuid not null references profiles(id)`.
- `created_at timestamptz not null`.
- Constraint stores ordered ids so each friendship exists once.

### `games`

- `id uuid primary key`.
- `white_player_id uuid not null references profiles(id)`.
- `black_player_id uuid not null references profiles(id)`.
- `status text not null check in ('invited','active','checkmate','stalemate','draw','resigned','abandoned','declined')`.
- `turn_player_id uuid references profiles(id)`.
- `turn_started_at timestamptz`.
- `turn_deadline_at timestamptz`.
- `turn_pace_days int not null check in (1,3,5)`.
- `current_fen text not null`.
- `pgn text not null default ''`.
- `ply_count int not null default 0`.
- `version int not null default 0`.
- `created_by uuid not null references profiles(id)`.
- `created_at timestamptz not null`.
- `updated_at timestamptz not null`.

### `moves`

- `id uuid primary key`.
- `game_id uuid not null references games(id)`.
- `ply_number int not null`.
- `player_id uuid not null references profiles(id)`.
- `uci text not null`.
- `san text not null`.
- `fen_before text not null`.
- `fen_after text not null`.
- `created_at timestamptz not null`.
- Unique `(game_id, ply_number)`.

### `notifications`

- `id uuid primary key`.
- `user_id uuid not null references profiles(id)`.
- `type text not null check in ('friend_request','game_invite','your_turn','game_complete')`.
- `game_id uuid references games(id)`.
- `friend_request_id uuid references friend_requests(id)`.
- `read_at timestamptz`.
- `created_at timestamptz not null`.

### `email_deliveries`

- `id uuid primary key`.
- `notification_id uuid not null references notifications(id)`.
- `recipient_user_id uuid not null references profiles(id)`.
- `status text not null check in ('queued','sent','failed','skipped')`.
- `provider_message_id text`.
- `last_error text`.
- `created_at timestamptz not null`.
- `sent_at timestamptz`.
