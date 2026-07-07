# ChessRiot Cofounder Handoff Summary

## My immediate to-dos

1. **Paste this summary into Cofounder** as the current product and implementation brief.

2. **Ask Cofounder to build the MVP as a mobile-friendly web app**, not native Android.

3. **Ask Cofounder to confirm its preferred stack** for database, auth, deployment, notifications, and engineering workflow.

4. **Put this summary into GitHub** as a project context file, for example `docs/conversation-summary.md` or `docs/product-brief.md`.

5. **Start implementation only after Cofounder confirms the workflow**, especially how its Engineering department turns specs into code.

---

# 1. Product name and current canonical direction

The working product name is now **ChessRiot**.

Earlier names included **CheckRiot**, **Pawnado**, and others, but the latest Cofounder summary says to treat **ChessRiot** as canonical unless we rename later.

Repo or product tagline candidate:

> A playful, AI-assisted chess game that helps kids learn, battle, and invent wild new rules.

Important naming note:

* The repo should be short, English, googleable, and not too generic.
* We still need final checks for domain availability, GitHub availability, and trademarks.
* Current suggested repo name: `chessriot`.

---

# 2. Core vision

ChessRiot is a playful chess app for kids and families.

The core is **real chess**, but the experience should feel more alive, visual, and fun than normal chess apps.

The long-term vision includes:

* Animated piece battles.
* Collectible visual sets.
* Skins for pieces, board, and even the home screen.
* Points for good moves and wins.
* A private AI chess coach.
* Async games between people who already know each other.
* Real-time games later.
* Creative rule variants and chaotic powers.
* Full Hebrew and English support, with Hebrew and RTL as first-class experiences.

The main user inspiration is **Omri, age 10**, who already knows chess and wants something more fun than a dry chess trainer.

---

# 3. ICP and users

Primary ICP:

* Chess-curious families.
* Kids roughly ages **6 to 13**, but the first design should probably focus tighter around **parent plus 6 to 10-year-old**.
* Parent is the installer, trust gatekeeper, and possible buyer.
* Kid is the daily user.

Important clarification:

* We used the phrase “family game,” but the actual MVP should not be limited to families.
* It means: **a game between two people who already know each other**.
* No random matchmaking in the MVP.

Example first users:

* Ron and Omri.
* Parent and child.
* Child and friend.
* Two known users playing remotely.

---

# 4. MVP decision

The MVP should be extremely small.

Current MVP:

* Mobile-friendly web app.
* Two users on separate devices.
* Google login.
* Required username.
* Add friend by username or email.
* Start an async chess game with that friend.
* Choose turn pace: maybe 1 day, 3 days, or 5 days per move.
* Play standard chess.
* Save full game history and move history.
* Send notification when it is your turn.
* No matchmaking.
* No coach yet.
* No animations yet.
* No special powers yet.
* No chaotic mode yet.

This is the smallest useful thing:

> Two known players can log in, find each other, start a turn-based chess game, make legal moves, get notified, and continue the game over time.

---

# 5. Features explicitly not in MVP

These should go into the backlog, not first build:

* Animated battles.
* AI chess coach.
* Points and rewards.
* Collectible skins.
* Home screen skins.
* Special powers.
* Chaos mode.
* Balanced variants.
* Real-time multiplayer.
* Matchmaking.
* Public social features.
* Monetization.
* Store publishing.
* Native Android app.
* APK distribution.

Important: the MVP should still be architected so these can be added later without rewriting everything.

---

# 6. Architecture decision: web app first

Earlier we discussed Android and APK, but the current decision is:

## Build a mobile-friendly web app first.

Reason:

* Cofounder apparently does not currently support native Android app generation.
* Web app is more compatible with Cofounder.
* It is faster for vibe coding.
* It can later become a PWA, installable on Android.
* It can later be wrapped as native Android if needed.

Conclusion:

> Web app now, Android wrapper later if needed.

This supersedes the earlier APK idea.

---

# 7. Architecture decision: Node backend

C# / Unity was discussed earlier, but it is no longer the current plan.

Current decision:

* **Node.js backend** is locked in as the preferred backend direction.
* This fits better with web deployment and vibe coding.
* It is likely easier for Cofounder, Claude, Codex, and Vercel-style deployment.

Open point:

* Cofounder must confirm what backend style it supports best: Node server, serverless functions, Supabase Edge Functions, or another pattern.

---

# 8. Deployment direction

Likely deployment:

* **Vercel** for the web app.
* Cofounder already seems to use Vercel for managed projects.
* Vercel is probably enough for frontend and possibly backend/serverless MVP.

But this is not fully confirmed.

Open Cofounder questions:

* Does Cofounder deploy app projects to Vercel automatically?
* Does it support backend APIs on Vercel?
* Does it support persistent databases?
* What database does it prefer?
* How does it handle environment variables and secrets?
* How does it handle auth callbacks?
* How does it handle push notifications?

---

# 9. Database and persistence requirements

Persistence is required from day one.

We need to store:

* Users.
* Google auth identity.
* Username.
* Friend relationships.
* Game records.
* Full move history.
* Current board state.
* Turn ownership.
* Turn deadline.
* Game status: active, completed, resigned, abandoned, etc.
* Timestamps.
* Eventually ratings, points, coach events, and learning history.

Important reason:

* The game history is not just technical data.
* It becomes the foundation for future ratings, progress, coaching, and personalization.

MVP storage can be simple, but must not be throwaway.

Likely database options:

* Supabase Postgres.
* Firebase.
* Vercel Postgres.
* Neon.
* Whatever Cofounder supports natively.

Open question for Cofounder:

> What database/storage option should we use for the MVP, given Cofounder’s native support?

---

# 10. Auth and onboarding

MVP onboarding decision:

* User must sign in with **Google login**.
* User must choose a **username**.
* Later we may support other login methods.

Reason:

* We need persistent identity.
* We need game history tied to the user.
* We do not want to build password auth for the MVP.

Initial onboarding flow:

1. User opens app.
2. User signs in with Google.
3. User chooses username.
4. User lands on home screen.
5. User can search for another player by username or email.
6. User sends friend request or connects.
7. Once connected, user can start a game.

Open question:

* Should usernames be globally unique?
* Can users be searched by email, username, or both?
* Do we expose email addresses in the UI, or only use email privately for lookup?

Strong recommendation:

* Make usernames globally unique.
* Allow invite/search by email for known users.
* Do not expose emails unnecessarily.

---

# 11. Starting a game

The MVP should not use anonymous game codes as the main flow.

Earlier code-based joining was suggested, but the preferred flow is now:

1. Find or add a friend.
2. Open friend profile or friend row.
3. Click “Start game.”
4. Choose turn pace:

   * 1 day per move.
   * 3 days per move.
   * 5 days per move.
5. Game starts.
6. Each player receives notification when it is their turn.

Game codes can maybe exist later, but not the core MVP.

Reason:

* Ron and Omri already know each other.
* Known-player flow is more natural.
* Friend relationships are reusable.
* It supports future family accounts and safety models.

---

# 12. Notifications

Notifications are required in MVP.

Reason:

* In async chess, the player needs to know when the opponent moved.
* Without notifications, games will stall.

MVP notification behavior:

* Notify player when it becomes their turn.
* Possibly notify when a friend request is received.
* Possibly notify when a game invite is received.

Open technical question:

* What notification system should be used for mobile web/PWA?
* Does Cofounder support web push notifications?
* Is email notification easier for MVP?
* Is WhatsApp/share link needed later?

Strong MVP fallback:

* In-app notifications plus email notifications if web push is too much.
* Web push can be added later if Cofounder makes it easy.

---

# 13. Chess rules and engine architecture

Even though the MVP is simple, the architecture must prepare for future modes.

Strong architectural principle:

> Separate core chess logic from presentation, animation, coaching, rewards, and variants.

Recommended conceptual layers:

1. **Core Chess Engine**

   * Legal moves.
   * Check.
   * Checkmate.
   * Stalemate.
   * Castling.
   * En passant.
   * Promotion.
   * Draw conditions, if included.

2. **Game State Layer**

   * Stores board state.
   * Stores current turn.
   * Stores game status.
   * Stores move history.

3. **Interaction Layer**

   * User selects piece.
   * User sees legal moves.
   * User submits move.

4. **Persistence Layer**

   * Saves moves and state.
   * Loads active games.
   * Handles conflicts.

5. **Future Extension Layers**

   * Coach.
   * Animation.
   * Points.
   * Skins.
   * Variants.
   * Chaos mode.

Important:

* Do not hard-code UI assumptions inside the chess logic.
* Do not mix animations with rule validation.
* Do not mix AI coach logic with legal move logic.
* Do not design only for standard chess if we know variants are coming.

Possible JS chess library:

* `chess.js` is a likely candidate, but Cofounder or the implementing AI should evaluate.
* Need a library that supports legal move validation and FEN/PGN style state.
* For future variants, we may need custom rule layers around the standard engine.

---

# 14. Core product behavior

Default mode:

* Standard chess.
* No powers.
* No chaos.
* No coach.
* No animations in MVP.

Long-term default:

* Still standard chess, but with optional animations, points, skins, and light coach.

Important principle:

> Chess integrity first. The child should know when they are playing real chess and when they are playing a fun variant.

Modes later:

1. **Classic Mode**

   * Real chess.
   * Good for learning.

2. **Balanced Variant Mode**

   * Special rules or powers, but balanced.

3. **Chaos Mode**

   * Wild, funny, intentionally unfair sometimes.
   * Example: king has 3 lives, random piece sets, strange powers.

---

# 15. Backlog: animations

Original vision includes animated piece battles.

Examples:

* When a piece captures another piece, show a short battle animation.
* Different visual sets have different animations.
* A fantasy set could use spells.
* A Minecraft-inspired set could have a creeper-like explosion.
* A military set could use weapons or tactics.
* A funny set could use slapstick attacks.

Important UX decision from earlier:

* Animations should eventually be on by default.
* After a few moves, the app can ask if the user wants to speed things up or disable animations.
* Users should be able to turn them off.

Current MVP:

* No animations.
* Keep architecture ready for them.

---

# 16. Backlog: skins and visual sets

Long-term:

* Players can choose how their pieces look.
* Each player can choose their own set.
* This allows matchups like fantasy vs. block-world-inspired, or robots vs. monsters.
* Every set can have its own animations and effects.

Omri’s extra idea:

* Skins should affect not only the board and pieces.
* The **home screen itself** should also change based on the selected skin.
* This should be added to the backlog.

Important copyright note:

* Public MVP should avoid copyrighted brands like Brawl Stars or Minecraft.
* Inspiration is okay.
* Direct clones or branded assets are not okay for public repo/product.
* For private play this is less relevant, but the repo is open source, so public assets must be original.

---

# 17. Backlog: points and rewards

Omri suggested:

* Players earn points not only for winning, but also for good moves.
* Harder wins should give more points.
* Points can later unlock animations, skins, effects, or special powers.

Possible future reward events:

* Win a game.
* Win against a stronger player.
* Make a strong move.
* Escape danger.
* Find checkmate.
* Promote a pawn.
* Come back from losing position.

Guardrail:

* No pay-to-win.
* No manipulative gacha for kids.
* No dark-pattern streaks.
* Rewards should support delight and learning, not addiction.

---

# 18. Backlog: AI coach

The AI coach was part of the larger vision, but removed from MVP.

Future behavior:

* Private coach whispers to the player.
* Opponent cannot see the content.
* Maybe opponent can see that the coach intervened, depending on fairness mode.
* Coach can warn before a serious blunder.
* Player can ignore coach.
* Player can ask for hint.
* Coach can visually show what might happen in 1 to 3 moves.

Coach settings:

* Off.
* Only critical blunders.
* Medium help.
* Help on every mistake.

Important fairness issue discussed:

* If one player uses the coach, should the other player know?
* Proposed answer: maybe show a small indicator that coach helped, but not reveal the advice.

Current MVP:

* No active coach.
* Maybe show “Coach coming soon” icon only.
* Do not build real coach yet.

---

# 19. Backlog: custom rules and chaos modes

Long-term wild ideas:

* Players can type custom rules into chat before a game.
* The system interprets the custom rules and creates a personalized chess variant.
* Example: “My queen can turn into a knight once.”
* Example: “The king has 3 lives.”
* Example: “Pawns can move two squares diagonally.”
* Example: “The king can jump like a knight once per game.”

Modes:

* **Balanced mode**: system tries to make powers fair.
* **Chaos mode**: weird and funny is allowed.
* **No special powers**: default for MVP and real chess.

Specific Omri/Ron idea:

* A king with 3 lives: must be captured three times to lose.
* Random mixed set: each piece may come from a different visual set.

Current MVP:

* No special powers.
* Backlog only.

---

# 20. Open-source contributor strategy

Cofounder suggested positioning:

> An open-source chess game for kids, built by parents and kids together.

This is both product and go-to-market.

Important contributor ideas:

* Public repo from early stage.
* Permissive license, likely MIT.
* Good first issues that a parent-child pair can work on.
* Gentle contributor docs.
* Clear README.
* No direct adult-to-minor DMs.
* Kids contribute with parent supervision.
* Safe crediting of minors, for example first name only or parent-approved handle.

Open questions:

* MIT or Apache-2.0?
* CLA or DCO?
* How to safely credit minor contributors?
* What docs are required before the repo goes public?
* Should public repo start now or after basic app exists?

Current leaning:

* MIT license.
* Public repo early.
* But privacy and child-safety contribution rules need care.

---

# 21. Cofounder context

Cofounder’s earlier summary said there are managed resources currently named from a prior project:

* GitHub app repo: `kugelblitz-one/balance`
* GitHub marketing repo: `Cofounder-Customer-Projects/balance-cfa5e3-marketing`
* Vercel app project: `balance-cfa5e3`
* Vercel marketing project: `balance-cfa5e3-marketing`
* Supabase project: `balance-cfa5e3`

These are named `balance` from a previous scaffold and may need renaming/rebranding to ChessRiot.

Open question:

* Should we rename these now or create fresh ChessRiot resources?

Important:

* There was also a separate “Balanced” bipolar app business plan pasted earlier.
* That is a separate project and should not be confused with ChessRiot.
* The `balance` resource names may be leftovers from that context.

---

# 22. Cofounder workflow uncertainty

We do not yet know the best workflow for combining:

* ChatGPT sessions.
* Cofounder sessions.
* GitHub.
* Cofounder Engineering department.
* Other AI coding tools like Claude Code or Codex.

Question to ask Cofounder:

> What is the recommended workflow for combining ChatGPT conversation summaries, GitHub specs, and Cofounder’s Engineering department implementation flow?

Specific unknowns:

* Should summaries be pasted into Cofounder directly?
* Should they be committed to GitHub as Markdown?
* Should Cofounder read files from the repo?
* Can Cofounder create PRs?
* Can Cofounder update existing code?
* How should feedback loops work?
* What should be the single source of truth: Cofounder, GitHub docs, or both?

Current preferred process:

1. Capture decisions in Markdown.
2. Commit to GitHub.
3. Paste same summary into Cofounder.
4. Ask Cofounder to use it as the implementation brief.
5. Let Cofounder produce or modify code.
6. Keep future decisions in GitHub docs.

---

# 23. Spec-first and vibe coding principle

The project should be vibe-coded, but not careless.

Important principle:

> The spec is the first-class citizen.

This means:

* Specs should be written clearly before implementation.
* Code is allowed to evolve quickly.
* But decisions should be captured in Markdown.
* Tests or test flows should exist early.
* The AI should be guided by product behavior, not just technical tasks.

Recommended repo docs:

* `README.md`: product overview and setup.
* `SPEC.md`: behavior spec.
* `MVP.md`: exact first scope.
* `BACKLOG.md`: future features.
* `ARCHITECTURE.md`: technical decisions.
* `OPEN_QUESTIONS.md`: unresolved questions.
* `TEST_FLOWS.md`: manual acceptance tests.
* `docs/conversation-summary.md`: this handoff summary.

---

# 24. Suggested MVP acceptance tests

These are not necessarily automated on day one, but should guide implementation.

## Onboarding

* New user opens app.
* User signs in with Google.
* User chooses username.
* User reaches home screen.
* User identity persists after refresh/reopen.

## Friend flow

* User A searches for User B by username or email.
* User A sends friend request.
* User B accepts.
* Both users now see each other as friends.

## Start game

* User A clicks friend.
* User A starts new game.
* User A chooses turn pace: 1, 3, or 5 days.
* User B receives invite.
* User B accepts.
* Game appears for both users.

## Chess move

* Current player makes a legal move.
* Move is saved.
* Board updates.
* Turn switches.
* Opponent is notified.
* Illegal move is rejected.

## Persistence

* User closes app.
* User reopens app.
* Game state is still correct.
* Move history is still visible.

## Completion

* Checkmate ends the game.
* Game history remains stored.
* Completed game appears in history.

---

# 25. Suggested short prioritized implementation to-do list

This is the actual short list.

1. **Create/rename the ChessRiot repo and add this spec summary.**

2. **Ask Cofounder to confirm stack support:** Vercel, Node, database, Google login, notifications.

3. **Build the smallest web MVP:** Google login, username, friends, async game, standard chess moves, persistence.

4. **Add turn notifications:** in-app first, email or web push if supported.

5. **Add basic test flows:** onboarding, friend invite, start game, make move, resume game.

---

# 26. Questions Cofounder should answer before or during implementation

## Cofounder workflow

1. What is the recommended workflow between ChatGPT summaries, GitHub files, and Cofounder Engineering?
2. Should we paste this brief into Cofounder, commit it to GitHub, or both?
3. Can Cofounder read and modify GitHub repo files directly?
4. Does Cofounder produce PRs or push directly?
5. How should we give feedback after each implementation pass?

## Platform and deployment

6. Is Vercel the default deployment target for the app?
7. Can Cofounder deploy backend APIs/serverless functions?
8. Can Cofounder manage environment variables and secrets?
9. Should we use one repo or separate app and marketing repos?

## Backend and database

10. What database does Cofounder recommend for this MVP?
11. Is Supabase already available and preferred?
12. Should we use Supabase Auth, Google OAuth directly, Firebase Auth, or another auth system?
13. How should game state and move history be modeled?

## Notifications

14. What notification mechanism is easiest in Cofounder?
15. Can we support PWA push notifications now?
16. Should MVP use email notifications first?

## Product scope

17. Does Cofounder agree MVP should exclude animations and coach?
18. Does Cofounder agree the first loop is async known-player chess?
19. Should friend requests be username-based, email-based, or both?
20. Should turn pace be 1, 3, and 5 days, or just one default pace for MVP?

## Safety and legal

21. What is the minimum privacy stance before testing with kids?
22. Do we need parental consent flows before public testing?
23. MIT or Apache-2.0?
24. CLA or DCO?
25. How do we safely handle minor contributors?

---

# 27. Important corrections from earlier conversation

A few earlier ideas are now superseded:

* **Unity is not current plan.** Web app first.
* **C# is not current plan.** Node backend preferred.
* **APK is not current plan.** Web/PWA first.
* **Coach is not MVP.** Backlog.
* **Animations are not MVP.** Backlog.
* **Game codes are not preferred MVP flow.** Friend/invite flow is preferred.
* **“Family game” should mean known-player async game**, not literally only family.

---

# 28. Final implementation brief for Cofounder

Build **ChessRiot**, a mobile-friendly web app for playful async chess between known players.

MVP scope:

* Google login.
* Required username.
* Home screen.
* Add/search friend by username or email.
* Invite friend to async chess game.
* Choose turn pace, probably 1, 3, or 5 days per move.
* Standard chess only.
* Legal move validation.
* Persistent game state and full move history.
* Notification when it is your turn.
* Basic game history.
* No matchmaking.
* No coach.
* No animations.
* No variants.

Technical direction:

* Web app first, PWA-friendly.
* Node backend.
* Vercel likely deployment.
* Database TBD based on Cofounder support.
* Keep chess engine isolated from UI and future features.
* Keep specs and test flows in Markdown as first-class project artifacts.

Backlog:

* Animated battles.
* Skins for pieces, board, and home screen.
* Points and rewards.
* AI coach.
* Balanced variants.
* Chaos mode.
* Real-time multiplayer.
* Hebrew and RTL soon, not too late.
* Open-source contributor flow for parent-child pairs.

Main open Cofounder ask:

> Confirm the recommended Cofounder workflow and stack, then implement the smallest async known-player chess MVP.
