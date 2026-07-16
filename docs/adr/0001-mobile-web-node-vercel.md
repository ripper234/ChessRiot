# ADR 0001: Mobile-first web app on Node and Vercel

## Status

Accepted

## Context

Earlier project notes considered native Android, Unity, and C#. The current MVP target is a smaller mobile-first web app for asynchronous known-user chess.

## Decision

Build the MVP as a Node-compatible mobile-first web app deployable on Vercel.

## Consequences

- Faster MVP delivery and easier Cofounder/Vercel workflow.
- PWA support remains possible later.
- Native Android and app-store distribution are deferred.
- The app must keep chess rules separate from framework-specific UI code.
