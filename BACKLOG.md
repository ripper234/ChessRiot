# ChessRiot backlog

## Backlog chat cards

| ID | Feature | Current status |
|---|---|---|
| CR-001 | Always-visible exact version | Shipped unobtrusively inside the unified Settings menu. |
| CR-002 | In-app feedback and GitHub contribution path | Shipped with isolated per-environment storage. |
| CR-003 | Short move and capture animation | Expanded in v0.17.0 to roughly one-second, non-blocking, piece-specific combat plus special chess-event effects. |
| CR-004 | Textless picker for visual themes | Expanded in v0.17.0 to 11 whole-app skins inside Settings, available before a game. |
| CR-005 | Portable user login | Guest private-seat links are live. Provider login remains disabled until it can add portability without blocking play. |
| CR-006 | All games for the logged-in user | The account-backed history remains in storage but is not exposed in guest mode. The current device shows recent private-seat games. |
| CR-007 | Step-by-step game replay | Shipped as Back/Forward live-board navigation and a collapsible full move table in the game sidebar. |
| CR-008 | Desktop install, move alerts, and time limits | Shipped. Install support, selectable one, three, or five-day move deadlines, and opt-in per-game closed-app turn notifications are live. |
| CR-009 | A winning piece defeats the king on checkmate | Shipped as a short, theme-aware, reduced-motion-safe finisher. |
| CR-010 | Subtle release updates and optional louder alerts | The unseen-release blue dot and generic closed-app turn alerts are shipped. Custom sounds or louder notification modes remain unplanned. |
| CR-011 | Per-game Magic Rules | Legacy stored games remain compatible. New rule entry is disabled, and the stable API rejects unsupported creation instead of silently creating Standard games. |
| CR-012 | Isolated branch preview environments | Local Sites preview is required for high-risk work. A durable hosted preview catalog remains backlog. |
| CR-013 | Optional confirmation before every move | Shipped as a default-off, browser-local setting covering tap, drag, keyboard, promotion, and complete Magic turns. |
| CR-015 | Solo is the default mode | Shipped in v0.9.3. The new-game screen opens with Solo selected and Level 3 visible. |
| CR-016 | White always begins | Verified in v0.9.3. White is always the first mover; Riot Bot commits the opening before a Black-side human can act. |
| CR-017 | Understand Magic Rules at runtime | Planned. Replace the fixed phrase compiler with a safe runtime interpretation boundary while preserving deterministic stored rules. |
| CR-018 | Numeric knight move counts | Planned with CR-017. Support equivalent wording such as “2 times” and define exact behavior for counts above two before shipping. |
| CR-019 | Mini Games menu | Shipped in v0.14.0 with Standard as the default plus Pawn Riot, Half Army, and Pawn Duel in Solo and Multiplayer. Literal kingless pawn chess still needs a separate rules engine. |
| CR-020 | Credit-priced Undo after a mistake | Backlog only. Define whether Undo is allowed against Riot Bot, human opponents, or both; whether the opponent must consent; and separate credit prices by mode before implementation. No current game may silently gain rewind semantics. |
| CR-021 | Schema authority and migrations | Replace runtime table creation and duplicated schema definitions with one migration-owned source of truth and a deploy-time migration check. |
| CR-022 | Riot Bot work ownership | Move bot computation behind a durable lease/queue boundary so concurrent Worker invocations cannot duplicate expensive search. |
| CR-023 | Durable push outbox | Commit notification intent with the game mutation and deliver it asynchronously with bounded retry and cleanup. |
| CR-024 | Privacy deletion and retention | Add explicit player-data deletion plus scheduled retention for games, feedback, telemetry, and notification records. |
| CR-025 | GameRoom decomposition | Split transport, optimistic state, history, effects, and controls into testable hooks/components without changing rules. |
| CR-026 | Content Security Policy | Add a nonce- or hash-based CSP after verifying Sites preview/hosting frames, service workers, media, and image optimization. |

This is the durable product backlog recovered from
[GitHub issue #11](https://github.com/ripper234/ChessRiot/issues/11) and
[merged PR #12](https://github.com/ripper234/ChessRiot/pull/12).

| # | Feature | Status | What must happen next |
|---|---|---|---|
| 1 | Daily win streaks with milestone rewards at 3, 7, 14, and 30 days | Blocked | Define a day boundary and rewards without dark-pattern pressure, then add account-bound streak state. |
| 2 | Weekly streak protection token | Blocked | Complete streaks first, then define earning, expiry, and consumption rules. |
| 3 | Unlockable skin collection and rarity tiers | Foundation shipped | v0.5.0 provides accounts and 11 original themes. Ownership, unlock rules, rarity, and a progression model remain undefined. |
| 4 | Limited-time holiday and seasonal skins | Blocked | Define the skin catalog, event calendar, availability policy, and original art pipeline. |
| 5 | Wacky random board modifiers such as fog, slippery pieces, and portals | Needs design | Define deterministic rules and build a variant engine separate from Standard Chess. |
| 6 | Earned one-time power cards such as shield, double move preview, and chaos swap | Needs design | Define exact card rules, balance, persistence, and strict separation from Standard Chess. |
| 7 | Kid-safe preset emote and reaction wheel | Shipped in v0.4.0 | Six authenticated presets, no free text, rate limiting, bounded history, hide control, privacy-safe telemetry, and a 15-minute post-game courtesy window. |
| 8 | Victory poses and finishers per skin or theme | First version shipped in v0.4.0 | The theme-aware victory finisher is live. Unique finishers can grow with the future skin catalog. |
| 9 | Daily and weekly missions for soft currency | Blocked | Define currency, reset rules, mission definitions, and anti-abuse handling. |
| 10 | Friend challenges with custom rule toggles and shared streaks | Partial foundation | Account-bound invitations and five safe per-game Magic Rules exist. A friend graph, broader rule catalog, and shared-streak rules remain undefined. |

## Additional evidenced backlog

- [Competitor research](https://github.com/ripper234/ChessRiot/issues/1)
- [Original reinterpretation of the requested branded skin](https://github.com/ripper234/ChessRiot/issues/3):
  the literal third-party skin request is superseded by the original-assets policy.
- [Skinnable AI teacher](https://github.com/ripper234/ChessRiot/issues/5)
- [Hebrew, RTL, and multilingual UI](https://github.com/ripper234/ChessRiot/issues/9)
- [Skin catalog and temporary classical-piece reveal](https://github.com/ripper234/ChessRiot/issues/7)
- [Skinnable AI tutor](https://github.com/ripper234/ChessRiot/issues/13)
- [Time-limit penalties](https://github.com/ripper234/ChessRiot/issues/14):
  first version shipped in v0.4.0 with explicit 1, 3, or 5-day turn pace,
  visible countdown, legacy-game protection, and server-authoritative timeout.
- [Multi-account switching](https://github.com/ripper234/ChessRiot/issues/15)
- [Add the Cofounder mockup to the README](https://github.com/ripper234/ChessRiot/issues/16):
  blocked until the source mockup asset is available.

Features marked blocked or needs design must not be approximated with
browser-only progression or undocumented chess rules. Standard Chess remains
the default and must not silently inherit variant mechanics.

## Other shipped backlog wins in v0.4.0

- Read-only, keyboard-accessible replay built entirely from immutable move history.
- Installable online PWA with static-asset-only caching.
- Opt-in opponent-move alerts while ChessRiot remains open in another tab or
  window. Closed-app push was deferred at that release.

## Shipped backlog wins in v0.6.0

- Paginated My Games history with explicit Your turn, Opponent's turn,
  Waiting, Won, Lost, and Draw states.
- Account-session move monitoring across every owned multiplayer game, without
  depending on a legacy private-seat token on the current device.
- Explicit Switch Account entrypoint through the trusted ChatGPT sign-out flow.

## Shipped backlog wins in v0.8.0

- `Knights move twice.` is a real server-enforced rule, not placeholder copy.
- The existing atomic rook-turn mechanism now supports the same knight moving
  a second legal time, including Riot Bot, touch, pointer, keyboard, history,
  and replay.
- Existing v1 Magic Rules remain valid; knight-enabled games use the v2 stored
  schema without mutating older games.

## Shipped backlog wins in v0.13.0

- An authorized multiplayer seat can opt one browser into a generic notification
  after an opponent commits a move, even when ChessRiot is closed.
- Associations are isolated by game, seat, and device endpoint. Disabling one
  game leaves the browser subscription and other game associations intact.
- Duplicate game versions cannot send twice, stale endpoints are removed, and
  push-service failures never affect the authoritative move.
