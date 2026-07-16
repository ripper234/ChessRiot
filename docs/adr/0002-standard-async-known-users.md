# ADR 0002: Standard asynchronous chess between known users only

## Status

Accepted

## Context

The long-term ChessRiot vision includes coach, animations, variants, powers, matchmaking, real-time play, skins, and rewards. These features conflict with the desired smallest MVP.

## Decision

The MVP supports only standard chess played asynchronously between accepted friends.

## Consequences

- No matchmaking, open chat, coach, powers, skins, animations, points, rewards, variants, or real-time play in MVP milestones.
- Friend relationships and persistent game history become foundational data.
- Future features must integrate through separate modules without changing standard chess integrity.
