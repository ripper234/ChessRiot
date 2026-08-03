# ChessRiot credit economy

**Status:** Product design draft only. Do not implement yet.  
**Date:** 2026-08-03  
**Scope:** Freemium earning and spending, paid Credits, Magicka access, economy security, fairness, playability, and comparative analysis.

## Executive decision

ChessRiot should launch with two visible currencies and one contextual ticket:

- **Courage** is earned through play, a few one-time feats, and qualified friend invitations. It cannot be purchased.
- **Credits** are the premium currency. Players receive one small promotional grant after meaningful activation, then may buy more.
- **Magicka** is a consumable ticket bought with either Courage or Credits. It appears beside Magic, not as a third wallet balance competing for attention.

Classic Chess, Mini Games, Mating Sets, legal moves, clocks, ratings, coaching safety, and competitive rewards must never become stronger through payment. Paid players get faster access to expression and more optional Magic experiences, never a better chance to win.

**Proposed Magic unit, pending confirmation:** one Magicka ticket sponsors one successfully generated Magic ruleset for a set of up to three valid completed games. The same immutable rules apply to both players, colors alternate when relevant, and the opponent pays nothing. Magic is unranked at launch. The ruleset may be used with any play mode only after that combination is explicitly supported and balanced. The current repository restriction that Mini Games cannot combine with Magic remains in force until separately redesigned.

## Hard guardrails

1. **Core chess is unlimited and free.** No energy meter, entry fee, paid move, paid clock, paid hint advantage, or paid rating protection.
2. **No paid power.** Credits cannot buy stronger pieces, more spells, extra moves, hidden information, favorable matchmaking, better odds, or an in-match advantage.
3. **No currency-priced Undo against humans.** The backlog's credit-priced Undo should remain unimplemented. If Solo Undo becomes a learning feature, it should be free and clearly excluded from scored achievements.
4. **No loot boxes or paid randomness.** Free surprise gifts are acceptable. Paid rewards must be known before purchase.
5. **No trading, transfer, gifting of balances, or cash-out.** Every asset is account-bound.
6. **No expiring paid Credits.** Courage and owned cosmetics also do not expire. A weekly free Magicka grant may be non-stacking, but it must not create a streak or loss penalty.
7. **No manipulative launch shop.** No countdown pressure, fake discounts, personalized prices, near-miss animations, or rotating artificial scarcity during the pilot.
8. **Classic play survives every economy outage.** Payment, referral, wallet, or LLM failures must fail closed without blocking ordinary chess.

## Level 1: Freemium

### Starter experience

After verified Google sign-in and username creation:

| Grant | Timing | Purpose |
|---|---|---|
| 120 Courage | Immediately | Puts the player one completed game away from a first cosmetic |
| 1 curated Magic trial | Immediately | Demonstrates a complete three-game Magic set with a precompiled ruleset and no LLM cost |
| 100 promotional Credits | After the first qualifying completed game and risk checks | Funds one basic skin or one generated Magicka set |

A **qualifying completed game** is confirmed by the server, reaches at least 20 plies, and ends through checkmate, stalemate, draw, or a valid resignation. A natural checkmate or promotion before 20 plies may still trigger its one-time skill feat, but it does not qualify for activation, weekly, or referral rewards. Cancelled invitations, immediate resignations, timeouts, duplicate games, client-reported results, and same-device local games do not qualify for repeatable rewards.

The starter Courage plus the first-game feat below totals 150 Courage, enough for one basic piece skin after a real play session. The starter Credits buy one basic skin or one generated Magicka set. Both grants therefore unlock an actual choice instead of leaving unusable fragments.

Promotional Credits are granted once per account. Suspicious clusters of newly created accounts on a risk-linked device may have the grant delayed for review, but a shared household network alone is never a denial signal.

### Earning Courage

Launch with a small, legible set of achievements. Do not reward endless grinding or repeated wins against a cooperating account.

| Feat | Courage | Frequency |
|---|---:|---|
| Complete the first qualifying game | 30 | Once |
| Deliver the first checkmate | 40 | Once |
| Promote the first pawn | 30 | Once |
| Complete a qualifying game in Standard, a Mini Game, and a Mating Set | 60 | Once |
| Complete five games without abandonment | 60 | Once |
| Play three distinct human opponents | 60 | Once |
| Complete three qualifying games in a calendar week | 50 | Once per week |

Rules:

- Feat logic is server-authoritative and deduplicated by account and feat ID.
- A week missed has no penalty and no streak resets. There is no escalating daily-login reward.
- Repeatable wins, number of captures, and raw game counts are excluded because they invite bots, win trading, and tedious play.
- Same-opponent games count at most once per day toward repeatable rewards.
- Economy configuration may pause a broken feat immediately, but already granted legitimate Courage is not silently removed.

### Qualified friend invitations

The referral loop should reward successful activation, not clicks or sign-ups.

A referral qualifies only when the invitee:

1. Is a new verified account attributed to one inviter.
2. Is at least 24 hours old.
3. Completes two qualifying human games in separate sessions, including one against a verified player other than the inviter.
4. Passes proportionate anti-abuse checks.

Rewards:

| Recipient | Reward |
|---|---:|
| Inviter | 100 Courage |
| Invitee | 50 Courage |

Limits:

- Maximum 4 rewarded referrals per rolling 30 days and 12 lifetime at launch.
- Rewards are Courage only. Referral rewards never produce paid-value Credits.
- Shared household IP addresses are not sufficient evidence of abuse. Use a combination of account age, device risk, session behavior, opponent graph, payment reuse, and velocity, with a manual support path for families sharing devices.
- Invitations are user-initiated links or shares. Do not upload contact books, auto-message contacts, or reward spam.

### Sustainable free Magic

Completing the first qualifying game of a calendar week refreshes one non-stacking **Weekly Spark**. This allowance is separate from purchased Magicka, is consumed first, and never disappears merely because the player owns tickets. This provides continuing access without a daily obligation, a buyer penalty, or a farmable stockpile.

## Level 2: Premium

### Buying Credits

Pilot packages:

| Credits | Reference price before localization |
|---:|---:|
| 100 | US$0.99 |
| 500 | US$4.99 |
| 1,000 | US$9.99 |

Launch rules:

- No package above US$10 during the pilot and no subscription yet.
- Use a stable, conspicuous ratio of approximately 100 Credits to US$1. Show the localized real-money equivalent beside every item.
- Do not use bulk bonuses initially. They obscure the exchange rate and encourage overbuying.
- Purchased and promotional Credits appear as one UI balance but remain separate internal lots for refunds, chargebacks, and accounting. Promotional Credits are spent first.
- Buying Courage, converting Courage into Credits, and mixing two tenders in one purchase are not supported.
- A purchase requires an explicit confirmation and a parental or platform gate where applicable. Never place a one-tap purchase control beside ordinary gameplay actions.
- The default real-money cap is US$20 per 24 hours and US$50 per rolling 30 days, localized by market. Only a verified adult may raise it.

### Spending Courage or Credits

Initial price bands are hypotheses for pilot testing, not permanent promises:

| Item | Courage | Credits | Ownership |
|---|---:|---:|---|
| Basic piece skin | 150 | 100 | Permanent, account-wide |
| Signature piece skin with distinct capture treatment | 450 | 300 | Permanent, account-wide |
| Full theme covering board, shell, UI, and audio | 300 | 200 | Permanent, account-wide |
| Signature animated theme | 650 | 500 | Permanent, account-wide |
| 1 Magicka ticket | 100 | 100 | Consumed only after successful generation |

Definitions:

- A **piece skin** changes the pieces and their capture presentation.
- A **theme** changes the wider app treatment, including the board, shell, UI, and audio. Existing whole-app skins should be recataloged consistently before pricing.
- Every launch cosmetic is earnable with Courage or purchasable with Credits. A small number of future supporter cosmetics may be Credits-only, but gameplay content and competitive tools may not be.
- Previewing any cosmetic is free and unlimited.
- A cosmetic purchase may be undone for five minutes only if it has not been used in a game, and returns the same currency lot. Free previewing should make returns exceptional rather than a rental system. Magicka purchases may be undone while the ticket is unused. Provider-level cash refunds follow the provider's rules.

### Magicka lifecycle

Magicka is an entitlement, not a freely exchangeable currency:

1. Creating a Magic invitation places one ticket or the Weekly Spark on hold for the same seven-day lifetime as the invitation. The Weekly Spark is always used first.
2. For Multiplayer, generation begins only after the opponent accepts. For Solo, it begins after the player confirms the rules prompt.
3. Deterministic validation rejects unsupported or abusive prompts before any model call. One entitlement authorizes one bounded model attempt. Server-owned transport retries remain tied to the same idempotency key.
4. The server compiles the accepted prompt into a versioned, allowlisted rule document. The entitlement is consumed only after the document is valid and durably saved.
5. A provider or server failure releases the entitlement only after a cooldown and still counts against account and global attempt limits. The same rejected prompt fingerprint cannot be retried for free. A user-cancelled or expired invitation releases an unused hold automatically.
6. Retries with the same set ID are idempotent and never consume a second entitlement.
7. The ruleset records its sponsor, rules version, expiry, completed-game counter, and server-created child game IDs. It expires after 30 days or after three qualifying completed games, with a maximum of five started games. Aborted games do not consume one of the three completions, and the sponsor may re-invite using the same ruleset.
8. Replays, reconnects, and color changes do not cost another ticket. Both players use identical rules and resources. There are no per-move purchases, paid rerolls, stronger spells, or payer-only abilities.

The LLM may output data matching a strict schema. It must never output executable code, external URLs, database queries, or client-trusted legality. The authoritative game server continues to validate every move.

## Why this should be fun

- **A real first choice:** one play session earns a basic skin, while the curated starter trial demonstrates the most distinctive ChessRiot feature immediately without model cost.
- **Expression over obligation:** themes and skins make the whole app feel like a toy collection without corrupting chess integrity.
- **Shared Magic:** one player sponsors the fun for both people. A three-game set creates a natural rematch loop and lets colors alternate under the same strange rules.
- **Memorable feats:** checkmate, promotion, mode variety, and new opponents celebrate chess stories. Raw grind counters do not.
- **Visible progress without chores:** prices and balances are transparent, weekly rewards do not escalate, and missing a week loses no streak.
- **Predictability with a little delight:** purchases are deterministic. Occasional free surprise cosmetics or community gifts can provide novelty without paid gambling.

## Economy health

### Faucets

- One-time starter Courage and promotional Credits.
- Finite one-time feats.
- Tightly capped qualified referrals.
- A small weekly Courage reward.
- One non-stacking Weekly Spark, independent of owned Magicka.

### Sinks

- Permanent cosmetics are the aspirational early sink.
- Magicka is the repeatable sink because it funds a new experience rather than disposable power.
- There is no Courage sink that affects competitive results.

Permanent cosmetics eventually saturate, as Brawl Stars itself observed with freely abundant cosmetic currency and its former always-open catalog. ChessRiot should therefore launch with a small, desirable catalog and treat Magicka experiences as the healthier recurring sink. It should not manufacture scarcity to compensate for weak content.

### Pilot targets

| Metric | Healthy initial range |
|---|---:|
| New players trying Magic within 7 days | 50% to 70% |
| New players spending starter Courage within 7 days | 30% to 70% |
| Median sessions to first basic cosmetic | 1 to 3 |
| Median time to a signature piece skin without referrals | 2 to 6 weeks |
| Median time to a signature animated theme without referrals | 6 to 12 weeks |
| Magic set completion | At least 75% |
| Never-paying players among Magic initiators | At least 50% |
| Qualified invite conversion | 20% to 40% |
| Confirmed referral fraud | Below 2% |
| Duplicate grants or double spends | Exactly zero |

Do not optimize revenue until the player sample shows that free users understand the currencies, reach a satisfying first unlock, and continue playing Classic Chess without pressure.

## Comparative analysis

| Game | Useful pattern | Pattern ChessRiot should reject |
|---|---|---|
| **Brawl Stars** | Purpose-separated currencies, visible progression, free sampling, collectible identity, and choice-oriented Keys | Currency sprawl, paid gameplay progression, grindy records, and paid/random reward systems. Bling was created for cosmetic access, but its 2026 shop bundles can also include progression. Supercell has acknowledged that raw win-count Records encouraged bots and felt unfun. |
| **Fortnite** | Core competitive access plus premium self-expression, clear cosmetic previews, and an unused-purchase cancellation path | Rotating FOMO and ambiguous purchase flows. The FTC's US$245 million order over unwanted charges and child purchases is a direct warning for ChessRiot. |
| **Roblox** | Referral rewards can wait until an invitee actually plays or completes a task | Rewards for mere clicks, self-referral, spam, or transferable cash-like referral value. |
| **Clash Royale** | Frequent milestones and a visible free track | Purchasable competitive progression, many overlapping currencies, random chests, and opaque value. |
| **Marvel Snap** | Collection goals and targeted acquisition | Paid direct or early access to gameplay cards, currency conversion chains, packs, and random bonus rewards. |
| **Chess.com** | Core play is unlimited and has no paid board power while premium value sits mainly in analysis, learning, convenience, and flair | ChessRiot should explicitly reject paid Daily timeout protection, which Chess.com includes in Gold. Cosmetic themes alone are also unlikely to sustain ChessRiot. |

The best synthesis is Fortnite and Chess.com's fairness boundary, Roblox's qualified referral, Brawl Stars' collectible delight, and none of Clash Royale or Marvel Snap's paid competitive progression.

## Security and abuse analysis

### Authoritative ledger

Use an append-only, server-authoritative ledger. Never store a user-editable balance as the source of truth.

Each ledger entry records:

- user ID, asset type, signed amount, reason, source object, actor, status, timestamp, environment, and configuration version;
- a unique idempotency key such as `starter:{user}`, `feat:{user}:{feat}`, `referral:{invitee}`, `purchase:{provider_transaction}`, or `magicka:{set}`;
- the specific Credit lot used for every purchase.

Required invariants:

- Grant, debit, and entitlement creation are atomic.
- Concurrent spends cannot make an available balance negative.
- Admin corrections are compensating entries, never edits or deletions.
- Cached balances reconcile to the journal.
- Development and Production use separate databases, product IDs, signing keys, webhook secrets, and economy configuration. Test value never migrates to Production.

### Threat model

| Threat | Control |
|---|---|
| Replaying a feat or referral request | Unique idempotency key and database constraint; server-observed qualification |
| Two concurrent purchases spend the same balance | Atomic debit and entitlement grant with serialized wallet mutation |
| Forged game result or client-edited balance | Server-authoritative game state and ledger; client data is advisory only |
| Self-referral and account farms | Delayed qualification, age and gameplay requirements, velocity caps, privacy-conscious device and account-graph risk signals |
| Punishing real families on one network | Never block on IP alone; hold suspicious rewards for review and offer a support path |
| Fake payment success or changed client price | Server-owned SKU mapping; verify signed provider event, amount, currency, and transaction before fulfillment |
| Duplicate or reordered payment webhooks | Deduplicate provider event and transaction IDs; process idempotently |
| Refund after Credits were spent | Track Credit lots; reverse with a ledger entry; permit paid-Credit debt and disable premium spending, but never block free Classic Chess |
| Free LLM rerolls | One generation per set ID; consume only on successful durable compilation; no user reroll after seeing valid rules |
| Prompt injection or unsafe generated rule | Bounded input and output, strict schema and allowlist, immutable rule document, no executable output, server legality checks |
| Admin fraud or accidental grant | Actor and reason on every action; two-person approval for large manual grants; audit and reconciliation |
| Economy bug or runaway model cost | Versioned configuration, limits, budget alarms, and independent kill switches |

Payment fulfillment should follow OWASP's guidance to validate SKU, amount, currency, order, and callback authenticity on the backend and to make fulfillment idempotent. Payment providers can deliver the same webhook more than once, so a successful browser redirect is never proof of payment.

### Children and purchase safety

ChessRiot is intended for children as well as adults, so the ethical baseline should be stronger than the minimum legal requirement:

- Require express confirmation and a parental or platform purchase gate where applicable.
- Show exact localized money value, owned balance, resulting balance, and item contents before confirmation.
- Provide free previews, an easy virtual-item undo, purchase history, and a clear support/refund route.
- Do not lock a child out of free chess because a parent disputes a charge.
- Do not use advertising identifiers, contact uploads, or unnecessary persistent device identifiers for referral fraud prevention. Keep risk signals coarse, access-controlled, and short-lived.
- Complete a jurisdiction and platform review before enabling real payments. Google Play requires a declared target audience and applies its Families policies when children are included.

### Limits and kill switches

Initial limits:

- Economy writes: 10 per minute per account.
- Referral redemption attempts: 5 per hour per account and 20 per hour per network.
- Checkout creation: 3 per 15 minutes and 10 per day per account or device.
- Unaccepted Magicka holds: maximum 3 per account, each expiring with its invitation after seven days.
- Magic generations: maximum 10 per day per account plus a global model budget.

Independent switches must disable paid sales, promotional grants, referral rewards, individual feats, individual SKUs, Magicka holds, Magicka consumption, and LLM generation without disabling Classic Chess.

Automatic pause candidates:

- Any ledger reconciliation mismatch or duplicated fulfilled transaction.
- Magic debit without successful generation above 0.1%.
- Magic generation failures above 5% for 15 minutes.
- Chargebacks above 1% over 30 days.
- Referral issuance above three times forecast or sampled fraud above 10%.
- LLM budget at 100%, with an alert at 80%.

## Rollout recommendation

1. Validate this design with a spreadsheet simulation and current model-cost assumptions.
2. Run the complete wallet, store, referrals, and Magicka flow with test value only for at least two weeks.
3. Tune prices from observed time-to-first-unlock, Magic usage, completion, fraud, and confusion. Do not tune for maximum spend.
4. Enable real Credit purchases for at most 10% of eligible adult or parent-gated accounts, with the US$10 package ceiling.
5. Expand only after at least 100 successful purchases, zero ledger discrepancies, acceptable refunds, and verified free-player fairness.

## Decisions still required before implementation

- Confirm whether the proposed three-game Magic set matches the intended meaning of "Magic all three games."
- Decide which current 11 whole-app skins remain free defaults and which become unlockable. Do not take away a skin already presented to existing players as owned.
- Define the exact safe Magic rule catalog and which game modes may combine with it.
- Choose the payment channel and complete tax, refund, age, parental-consent, and platform review.
- Approve or reject Credits-only supporter cosmetics.
- Reprice only after a model-cost simulation and a small playtest validate the proposed numbers.

## Sources reviewed

- [Brawl Stars in-game currencies](https://support.supercell.com/brawl-stars/en/articles/currencies-2.html)
- [Brawl Stars 2026 Pass and economy changes](https://supercell.com/en/games/brawlstars/blog/news/new-power-brawl-pass-changes-and-a-new-starr-drop-2/)
- [Brawl Stars analysis of Records and reward design](https://supercell.com/en/games/brawlstars/blog/game-updates/about-the-update-records-changes/)
- [Brawl Stars changes to Bling, shop, and cosmetics](https://supercell.com/en/games/brawlstars/blog/news/changes-to-bling-shop-and-cosmetics/)
- [Fortnite V-Bucks acquisition](https://www.epicgames.com/help/c-202300000001636/c-202300000001723/how-do-i-get-v-bucks-in-battle-royale-a202300000017943)
- [Fortnite Item Shop](https://www.fortnite.com/item-shop)
- [Fortnite virtual-item cancellation and refunds](https://www.epicgames.com/help/c-202300000001636/c-202300000001723/how-to-cancel-or-refund-fortnite-item-shop-purchases-made-with-v-bucks-a202300000016816)
- [Roblox Friend Invite Reward System](https://en.help.roblox.com/hc/en-us/articles/36639668871700-Friend-Invite-Reward-System)
- [Roblox referral-program terms](https://en.help.roblox.com/hc/en-us/articles/35146071523604-In-Experience-Friend-Rewards-Program-Terms)
- [Clash Royale Pass economy](https://support.supercell.com/clash-royale/en/articles/pass-royale-11.html)
- [Clash Royale Gems and Gold](https://support.supercell.com/clash-royale/en/articles/gems-and-gold-9.html)
- [Clash Royale Shop offers](https://support.supercell.com/clash-royale/en/articles/shop-offers-2.html)
- [Clash Royale Lucky Chests](https://support.supercell.com/clash-royale/en/articles/lucky-chests-7.html)
- [Marvel Snap Fractured Frontier season](https://marvelsnap.com/new-season-fractured-frontier/)
- [Marvel Snap Packs and Token economy](https://marvelsnap.com/snap-packs-are-here/)
- [Chess.com membership comparison](https://support.chess.com/en/articles/8562418-what-does-each-level-of-premium-membership-get-me)
- [FTC order concerning Fortnite unwanted purchases](https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-finalizes-order-requiring-fortnite-maker-epic-games-pay-245-million-tricking-users-making)
- [OWASP third-party payment gateway guidance](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Payment_Gateway_Integration_Cheat_Sheet.html)
- [Stripe webhook duplicate-event guidance](https://docs.stripe.com/webhooks)
- [Google Play target-audience and Families requirements](https://support.google.com/googleplay/android-developer/answer/9867159)
