# ChessRiot backlog

## Backlog chat cards

| ID | Feature | Status in v0.4.0 |
|---|---|---|
| CR-001 | Always-visible exact version | Shipped globally with a changelog link. |
| CR-002 | In-app feedback and GitHub contribution path | Shipped with isolated per-environment storage. |
| CR-003 | Short move and capture animation | Shipped with reduced-motion support. |
| CR-004 | Textless picker for nine visual themes | Shipped with nine original, locally persistent themes. |
| CR-005 | Portable user login | Blocked on choosing and configuring an identity provider, account recovery, and migration from private seat links. |
| CR-006 | All games for the logged-in user | Partial: recent private games remain available on the current device. A complete cross-device list depends on CR-005. |
| CR-007 | Step-by-step game replay | Shipped with Start, Back, Next, End, and keyboard controls. |
| CR-008 | Desktop install, move alerts, and time limits | Shipped as an installable online PWA, optional open-app alerts, and selectable one, three, or five-day move deadlines. Closed-app push still needs server push credentials. |
| CR-009 | A winning piece defeats the king on checkmate | Shipped as a short, theme-aware, reduced-motion-safe finisher. |
| CR-010 | Subtle release updates and optional louder alerts | Shipped as an unseen-release blue dot plus opt-in browser alerts while the app remains open. |

This is the durable product backlog recovered from
[GitHub issue #11](https://github.com/ripper234/ChessRiot/issues/11) and
[merged PR #12](https://github.com/ripper234/ChessRiot/pull/12).

| # | Feature | Status | What must happen next |
|---|---|---|---|
| 1 | Daily win streaks with milestone rewards at 3, 7, 14, and 30 days | Blocked | Add durable player accounts, define a day boundary, and define rewards without dark-pattern pressure. |
| 2 | Weekly streak protection token | Blocked | Complete streaks first, then define earning, expiry, and consumption rules. |
| 3 | Unlockable skin collection and rarity tiers | Foundation shipped | v0.4.0 adds nine original local visual themes. Account-bound ownership, unlock rules, and rarity still need an identity and progression model. |
| 4 | Limited-time holiday and seasonal skins | Blocked | Build the account-bound skin catalog, original art pipeline, event calendar, and availability policy. |
| 5 | Wacky random board modifiers such as fog, slippery pieces, and portals | Needs design | Define deterministic rules and build a variant engine separate from Standard Chess. |
| 6 | Earned one-time power cards such as shield, double move preview, and chaos swap | Needs design | Define exact card rules, balance, persistence, and strict separation from Standard Chess. |
| 7 | Kid-safe preset emote and reaction wheel | Shipped in v0.4.0 | Six authenticated presets, no free text, rate limiting, bounded history, hide control, privacy-safe telemetry, and a 15-minute post-game courtesy window. |
| 8 | Victory poses and finishers per skin or theme | First version shipped in v0.4.0 | The theme-aware victory finisher is live. Unique finishers can grow with the future skin catalog. |
| 9 | Daily and weekly missions for soft currency | Blocked | Add accounts, currency, reset rules, mission definitions, and anti-abuse handling. |
| 10 | Friend challenges with custom rule toggles and shared streaks | Partial foundation | Private friend invitation links exist. Custom rules and cross-game shared streaks need product rules and durable identity. |

## Additional evidenced backlog

- [Hebrew, RTL, and multilingual UI](https://github.com/ripper234/ChessRiot/issues/9)
- [Skin catalog and temporary classical-piece reveal](https://github.com/ripper234/ChessRiot/issues/7)
- [Skinnable AI tutor](https://github.com/ripper234/ChessRiot/issues/13)
- [Time-limit penalties](https://github.com/ripper234/ChessRiot/issues/14):
  first version shipped in v0.4.0 with explicit 1, 3, or 5-day turn pace,
  visible countdown, legacy-game protection, and server-authoritative timeout.
- [Multi-account switching](https://github.com/ripper234/ChessRiot/issues/15)

Features marked blocked or needs design must not be approximated with
browser-only progression or undocumented chess rules. Standard Chess remains
the default and must not silently inherit variant mechanics.

## Other shipped backlog wins in v0.4.0

- Read-only, keyboard-accessible replay built entirely from immutable move history.
- Installable online PWA with static-asset-only caching.
- Opt-in opponent-move alerts while ChessRiot remains open in another tab or
  window. Closed-app push is still deferred.
