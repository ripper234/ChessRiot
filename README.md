# CheckRiot

**A playful, AI-assisted chess game that helps kids learn, battle, and invent wild new rules.**

CheckRiot is a chess game for kids, parents, and playful adults. The default experience is real chess, with Hebrew-first coaching, expressive animations, themed piece sets, and gentle learning support. Around that core, the game can open into optional chaotic modes where players invent custom powers, weird rules, and cinematic battles.

This README is the product and behavior spec. Technical architecture, code structure, and implementation details can live in separate docs, but this file should stay readable by a founder, parent, designer, developer, and AI coding agent.

---

## 1. Core idea

CheckRiot should feel like chess became alive.

A child should be able to open the game and immediately feel:

- This is not boring.
- I can make it mine.
- I can play real chess.
- I can learn without being lectured.
- I can also break the rules in special modes and invent crazy games.

The game starts from a serious chess foundation, then adds layers of fun, identity, coaching, animation, rewards, and creative rule-making.

---

## 2. Target players

Primary player:

- Around age 10.
- Already knows the basic rules of chess.
- Likes games with characters, progression, unlocks, surprises, and visual action.
- May enjoy chess, but can get bored if the experience feels dry or slow.

Secondary players:

- Parents playing with their kids.
- Kids at different levels.
- Adults who enjoy creative variants and chaotic rule sets.
- Stronger players who still want coaching and post-move explanations.

The product must work for a child, but should not feel childish in a shallow way. It should be playful, sharp, and alive.

---

## 3. Product principles

1. **Real chess first**
   
   The default mode is normal chess, with no powers and no rule changes.

2. **Fun before instruction**
   
   The first emotional hook is play, identity, animation, and battle energy. Teaching is woven into the experience.

3. **Spec is the source of truth**
   
   Product behavior should be captured in specs and acceptance tests before or alongside code.

4. **Coaching should feel like a whisper, not a school lesson**
   
   The coach helps at meaningful moments, privately, and can be tuned or turned off.

5. **Chaos is opt-in**
   
   Crazy powers, custom rules, and strange variants live in separate modes so they do not confuse the learning of real chess.

6. **Player agency matters**
   
   Players choose themes, animation speed, coach intensity, game modes, and sometimes even the rules.

7. **Hebrew-first**
   
   The app should be usable fully in Hebrew. English can come later.

---

## 4. First-run experience

On first launch, the app should quickly understand the player without creating a boring onboarding flow.

The app should ask 1 or 2 playful questions, such as:

- "How well do you already know chess?"
- "What kind of game do you want now: normal, learning, battle, or chaos?"

The app should avoid assuming the player is a total beginner. The target child may already know how pieces move and may have played many games.

The first experience should get the player into a game quickly.

---

## 5. Language and voice

The app is Hebrew-first.

Behavior requirements:

- All main UI text should be Hebrew.
- Chess explanations should be in natural Hebrew.
- Coaching should feel friendly and direct.
- Voice is optional, not required.
- The player can use the app without audio.
- Voice can help sometimes, especially for younger players or long explanations.

Possible coach tone:

- Short.
- Encouraging.
- Not condescending.
- Clear about tradeoffs.
- Focused on the board, not generic praise.

Example:

> רגע, המהלך הזה משאיר את המלכה שלך חשופה. רוצה רמז קטן לפני שאתה מאשר?

---

## 6. Default game mode

The default mode is normal chess.

Default mode includes:

- Standard chess rules.
- No special powers.
- No rule mutations.
- Themed visual pieces allowed.
- Capture animations allowed.
- Points and rewards allowed.
- Coach enabled by default at a gentle level.

Default mode must not damage chess learning. A child should understand that this is real chess.

---

## 7. Visual identity and piece sets

Players can choose how their pieces look.

Each player may choose their own set. This means one player can use one theme and the opponent can use another theme.

Example theme directions:

- Fantasy warriors.
- Wizards and monsters.
- Sci-fi robots.
- Ancient armies.
- Silly creatures.
- Pixel block world inspired themes.
- Arena-brawler inspired themes.
- Battle royale inspired themes.

Important IP rule:

- Public versions should not use copyrighted brands directly.
- Internal prototypes may use placeholders or personal inspiration.
- Public assets should be original, parody-safe, licensed, or clearly non-infringing.

The dream experience:

- A fantasy army can battle a pixel-creature army.
- Each side feels visually distinct.
- Pieces are still readable as chess pieces.
- Theme should never make the board confusing.

---

## 8. Capture animations

When one piece captures another, the game should show a short battle animation.

Examples:

- A knight charges.
- A bishop casts a beam.
- A rook slams forward.
- A queen unleashes a dramatic attack.
- A pixel-style creature explodes like a blocky blast.

Animation behavior:

- Animations are on by default.
- After 3 or 4 moves, the app should gently offer a way to make the game faster.
- The player can reduce or disable animations.
- Animation speed should be configurable.
- Competitive players can choose fast mode.

Suggested prompt after a few moves:

> רוצה להאיץ את המשחק? אפשר לקצר או לכבות את האנימציות בהגדרות.

Each theme can have its own animation style. In advanced versions, animation can depend on both the attacking piece theme and defending piece theme.

---

## 9. Game modes

### 9.1 Normal mode

Real chess, no powers.

Purpose:

- Learn and improve at chess.
- Play fair games.
- Use coaching.
- Earn points for good play.

### 9.2 Balanced variant mode

A special mode with powers or asymmetry, but the system tries to keep the game fair.

Examples:

- Stronger player starts with fewer pieces.
- One player receives small powers to compensate for skill gap.
- The system suggests handicap settings based on player rating or history.

Purpose:

- Make parent-child games more fun.
- Let weaker players have real chances.
- Preserve challenge for both sides.

### 9.3 Chaos mode

A playful mode where the game can become wild.

Examples:

- Every piece can come from a different random set.
- A king may have 3 lives.
- Pawns may move in unusual ways.
- A king may get one knight-jump per game.
- Players can invent strange rules in chat.

Purpose:

- Fun.
- Creativity.
- Surprise.
- Replayability.

Chaos mode does not teach standard chess directly. It should be clearly marked as a variant.

### 9.4 Custom prompt mode

Before a game starts, each player can type what powers or special rules they want.

Example prompts:

- "I want my queen to turn into a knight once."
- "My king has 3 lives."
- "My pawns can move two squares diagonally once per game."
- "Every time my rook captures, it gets a shield."

The system then converts the requests into a structured rule set.

Requirements:

- The system must explain the generated rules before the game starts.
- Both players should accept the rules.
- The game should label the result as a variant, not normal chess.
- In balanced mode, the system should warn if rules are probably unfair.
- In chaos mode, unfairness can be allowed if both players accept.

---

## 10. Multiplayer

The game should support playing against:

- The computer.
- Another person in real time.
- Another person asynchronously.

### 10.1 Real-time play

Players are online at the same time.

Behavior:

- Moves appear immediately.
- Timers may be optional.
- Coach advice remains private.
- Capture animations can play for both players, possibly with each player’s own settings.

### 10.2 Async play

Players can play over days.

Example:

- One player makes a move.
- The other player has up to 3 days to respond.
- The game continues as a long-running session.

Behavior:

- The app stores game state reliably.
- Players can have multiple async games open.
- Notifications can remind players when it is their turn.
- Coach can help during async turns.

Async play is important for parent-child games where both players are not always free at the same time.

---

## 11. Skill balancing and handicaps

The app should support games between players of very different skill levels.

Examples:

- Stronger player starts without a queen.
- Stronger player starts without one rook.
- Stronger player has less time.
- Weaker player receives limited hints.
- Weaker player gets a small variant power in balanced mode.

The system should learn from game history and suggest fair settings.

Example:

> נראה שאתה מנצח הרבה. רוצה משחק מאוזן יותר שבו תתחיל בלי רץ אחד?

The goal is not to punish stronger players. The goal is to create games that stay interesting for both players.

---

## 12. Chess coach

The chess coach is a private assistant that helps a player improve while playing.

The coach should be active by default at a gentle level.

### 12.1 Coach privacy

Coach advice is private.

If Player A receives advice, Player B should not see the content.

Open design question with current preferred answer:

- The opponent may see a small indicator that coaching happened, but not the advice itself.
- This keeps fairness visible without exposing private learning.

Example indicator:

> Coach used

or visually:

- Small lightbulb icon near the player’s name.
- No details shown.

### 12.2 Coach intensity

Each player can choose how active the coach is.

Levels:

1. Off.
2. Critical mistakes only.
3. Big mistakes and missed tactics.
4. Every mistake.
5. Training mode, very active.

This setting should be per player and per game.

### 12.3 Coach timing

The coach can intervene before a move is confirmed.

Example:

> Are you sure you want to do that?

Player choices:

- Yes, make the move.
- No, I want to think again.
- Give me a hint.

The coach should not stop every move. It should interrupt only according to the chosen intensity.

### 12.4 Hints

Hints should be layered.

Level 1:

> Look at what your opponent can capture next.

Level 2:

> Your queen may be in danger after this move.

Level 3:

> If you move there, Black can play bishop to g4 and attack your queen.

Level 4:

Show the line visually on the board.

### 12.5 Visual explanations

The coach should be able to show what would happen over the next few moves.

Behavior:

- Highlight threatened pieces.
- Show arrows for likely moves.
- Ghost-preview the board after a tactical sequence.
- Let the player step through the line.
- Keep explanation short and concrete.

### 12.6 Post-move learning

After a move or game, the coach can explain:

- Best move.
- Blunder.
- Missed checkmate.
- Missed capture.
- Fork.
- Pin.
- Skewer.
- Hanging piece.
- Unsafe king.

For children, explanations should use simple language and examples.

---

## 13. Points, rewards, and progression

Players earn points for:

- Winning.
- Winning a hard game.
- Finding a strong move.
- Avoiding a blunder after a coach warning.
- Completing a tactic.
- Playing consistently.
- Trying a new mode.

Winning should give more points, especially if the win was difficult.

Good moves during a game can also earn points. The app should not wait until the end to reward the player.

Points can unlock:

- New capture animations.
- New piece sets.
- New board styles.
- Cosmetic effects.
- Optional powers for variant modes.
- Coach personalities or voices.

Important fairness rule:

- In normal chess, unlocks should be cosmetic or learning-related.
- Purchased or unlocked powers should only affect variant modes.

The economy should motivate improvement without becoming manipulative.

---

## 14. Learning model

The app should learn the player’s level over time.

Signals:

- Opening knowledge.
- Blunders.
- Missed captures.
- Checkmate awareness.
- Piece safety.
- Tactical motifs.
- Endgame decisions.
- Time spent thinking.
- Coach usage.
- Win/loss record.

The app should adapt:

- Coach frequency.
- Puzzle difficulty.
- Opponent strength.
- Handicap suggestions.
- Recommended lessons.

The learning should feel like playing, not like entering a course.

---

## 15. Lessons and challenges

Lessons should be embedded into gameplay.

Examples:

- After a missed fork, offer a 30-second fork challenge.
- After losing a queen, show a mini lesson about hanging pieces.
- After a good checkmate idea, celebrate and explain the pattern.

Daily challenges can exist, but they should not be the main hook. The main hook is playing chess with personality, progression, coaching, and cinematic moments.

---

## 16. AI-generated rules

One of the strongest long-term ideas is custom game generation from chat.

Flow:

1. Player chooses Custom or Chaos mode.
2. Each player writes what kind of powers or rules they want.
3. The app converts text into structured rules.
4. The app explains the rules clearly.
5. Players approve.
6. The game starts.

The system should support rule templates internally, even if the user writes freely.

Example internal rule structure:

```json
{
  "mode": "chaos",
  "rules": [
    {
      "id": "king_three_lives",
      "piece": "king",
      "lives": 3
    },
    {
      "id": "queen_transform_once",
      "piece": "queen",
      "transform_to": "knight",
      "uses_per_game": 1
    }
  ]
}
```

The game must not let generated rules break basic app stability. Invalid or impossible rules should be rejected or simplified.

---

## 17. Rule separation

The game must clearly separate:

- Core chess rules.
- Balanced variants.
- Chaos variants.
- Cosmetic systems.
- Coaching systems.
- Reward systems.

Normal chess should remain clean and reliable.

Chaos mode can be wild, but should not infect the core rules engine.

---

## 18. Safety, kids, and privacy

Because kids may use the app, the product should be careful.

Requirements:

- No open chat between strangers in the MVP.
- Parent-controlled friend invites.
- No public profiles for children in the MVP.
- No manipulative monetization.
- No direct use of copyrighted brands in public releases.
- Clear distinction between real chess and variants.
- Private coach messages should not shame the player.

The game should feel emotionally safe. It should help kids learn without embarrassment.

---

## 19. MVP scope

The first playable MVP should include:

1. Android build.
2. Normal chess mode.
3. Hebrew UI basics.
4. Two local players on one device or simple online play.
5. Async game support if feasible early.
6. A few visual themes.
7. Capture animations on by default.
8. Animation speed or disable setting.
9. Basic coach with pre-move blunder warning.
10. Coach intensity setting.
11. Points for wins and strong moves.
12. One simple variant mode, probably King with 3 lives.

Do not try to build every chaos feature in the first MVP.

---

## 20. Prototype shortcuts allowed

For early one-shot or few-shot implementation, these shortcuts are acceptable:

- Use simple 2D board before full 3D.
- Use placeholder assets.
- Use simple animations before cinematic battles.
- Use local mock backend before production networking.
- Use a simple chess engine adapter before advanced coaching.
- Use predefined powers before fully AI-generated powers.
- Use text-based explanations before rich visual lines.

The product should be architected so these shortcuts can later be replaced.

---

## 21. Acceptance test ideas

### Test 1: Default game is real chess

Given a new player starts a game  
When they choose the default play option  
Then the game uses standard chess rules  
And no special powers are active  
And visual themes do not change legal moves.

### Test 2: Animations are on by default

Given a new game starts  
When a piece captures another piece  
Then a capture animation plays  
And after several moves the player is offered a way to speed up or disable animations.

### Test 3: Coach warns before a blunder

Given coach intensity is set to critical mistakes  
When the player attempts a move that loses a queen immediately  
Then the coach privately asks for confirmation  
And the player can make the move anyway  
Or ask for a hint.

### Test 4: Coach privacy

Given two players are in a game  
When Player A receives a coach hint  
Then Player B cannot see the hint content  
And Player B may only see a small indicator if the game settings allow it.

### Test 5: Async play works

Given Player A makes a move in an async game  
When Player B opens the game later  
Then Player B sees the updated board  
And can make the next move  
And the game remembers whose turn it is.

### Test 6: Chaos mode is separate

Given a player chooses normal chess  
When they open available powers  
Then powers are unavailable or cosmetic only  
But when they choose chaos mode  
Then variant powers can be enabled.

### Test 7: King with 3 lives

Given King with 3 lives mode is active  
When a king is captured the first time  
Then the king loses one life  
And the game continues  
When the king loses the third life  
Then the game ends.

### Test 8: Rewards do not break normal chess

Given a player earns points  
When they unlock a new power  
Then that power can be used only in variant modes  
And normal chess remains standard.

---

## 22. Open decisions

These decisions can be made later:

- Final product name.
- Exact visual style.
- Whether the board is 2D, 2.5D, or 3D.
- Whether to show coach-use indicators by default.
- Which online backend to use.
- Which chess engine to use.
- Whether voice coach ships in MVP.
- How AI-generated rules are moderated and validated.
- Whether this becomes open source long term.

---

## 23. Strong product opinion

The game should not start as a "course for chess".

It should start as a magical chess battle app that secretly makes you better.

The most important product bet is this:

> A child will stay because the game feels alive. The child will improve because the coach and game design quietly turn every important mistake into a learning moment.

