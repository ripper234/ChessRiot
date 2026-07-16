# ADR 0003: Evaluate Supabase before reuse

## Status

Proposed

## Context

Existing managed resources may include a Supabase project named `balance-cfa5e3`, inherited from another project context.

## Decision

Supabase is an appropriate MVP database/auth candidate, but the existing project should be reused only after confirming it has no unrelated data, policies, or secrets and can be safely configured for ChessRiot. Otherwise, create a fresh ChessRiot Supabase project.

## Consequences

- Avoids accidental cross-project data, naming, or secret leakage.
- Preserves Supabase as the recommended simple Postgres/Auth/RLS path.
- Requires an explicit resource approval before implementation starts.
