export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  summary: string;
  changes: string[];
  githubUrl: string;
}

const REPOSITORY_URL = "https://github.com/ripper234/ChessRiot";

export const RELEASES: ReleaseNote[] = [
  {
    version: "0.8.2",
    date: "2026-07-25",
    title: "One front door",
    summary: "ChessRiot now has one fixed public homepage and direct guest play with no login gate.",
    changes: [
      "Made the public homepage identical for every visitor, independent of hosting identity and saved game theme.",
      "Moved new-game setup to /app and enabled guest Solo and Multiplayer creation with a display name.",
      "Made private seat links authoritative for guest play while preserving existing account memberships and older games.",
      "Limited themes to active games so public, setup, invitation, changelog, loading, and error pages keep one consistent style.",
      "Removed all user-facing login prompts and kept the retired CAPTCHA path absent.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.8.2`,
  },
  {
    version: "0.8.1",
    date: "2026-07-25",
    title: "Direct entry",
    summary: "Players now enter ChessRiot immediately, without a separate human-check screen.",
    changes: [
      "Removed the Turnstile screen, verification request, and CAPTCHA-bound application session.",
      "Kept trusted hosting identity, account-bound game membership, request-origin checks, and account rate limits.",
      "Retired the old CAPTCHA endpoint and redirected existing verification entry points safely into the game.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.8.1`,
  },
  {
    version: "0.8.0",
    date: "2026-07-25",
    title: "Knights move twice",
    summary: "Magic knights can now move twice, and game requests work correctly inside the production sandbox.",
    changes: [
      "Made “Knights move twice.” a real deterministic Magic Rule for Solo and Multiplayer games.",
      "Generalized atomic two-leg turns so the same enabled rook or knight may move again, while a checking first leg still ends the turn.",
      "Kept existing v1 Magic Rule documents readable and unchanged while storing knight-enabled games in the compatible v2 schema.",
      "Extended tap, drag, keyboard, replay, move history, labels, and Riot Bot play to two-step knights.",
      "Fixed the production request-origin blocker without relaxing cross-site protection.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.8.0`,
  },
  {
    version: "0.7.0",
    date: "2026-07-25",
    title: "Magic Rules",
    summary: "Every new Solo or Multiplayer game can optionally carry its own safe, immutable rule changes.",
    changes: [
      "Added an optional Magic Rules box to game creation with a concise natural-language prompt.",
      "Compiled recognized prompts into versioned rules and rejected unsupported text instead of executing arbitrary code or silently ignoring it.",
      "Added atomic two-step rook turns: the same rook may move again before the turn ends, while giving check ends the turn immediately.",
      "Added no-promotion, no-castling, and no-en-passant rules with server, client, replay, and Riot Bot enforcement.",
      "Showed Magic Rules before joining, during play, in replay and move history, and on My Games cards.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.7.0`,
  },
  {
    version: "0.6.0",
    date: "2026-07-25",
    title: "Every game, every turn",
    summary: "A complete My Games history and account-aware alerts make asynchronous play reliable across devices.",
    changes: [
      "Added cursor pagination so My Games can reach the complete account history instead of stopping at 50 games.",
      "Added clear Your turn, Opponent's turn, Waiting, Won, Lost, and Draw states to every game card.",
      "Made open-app opponent-move alerts watch all owned multiplayer games through the account session.",
      "Removed the alert dependency on a legacy private-seat token or the currently open game route.",
      "Added a clear Switch Account action through the trusted ChatGPT sign-out flow.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.6.0`,
  },
  {
    version: "0.5.0",
    date: "2026-07-24",
    title: "Secure accounts and a bigger board",
    summary: "Account access, a human check, a board-first layout, and original illustrated themes make ChessRiot safer and more immersive.",
    changes: [
      "Required a ChessRiot account and server-verified CAPTCHA before any game could be created or played.",
      "Added account-bound game access, per-account rate limits, and bot-turn leases to reduce automated abuse and duplicate AI work.",
      "Made the board fill the available desktop or mobile viewport and collapsed secondary match tools.",
      "Showed the starting position before animating Riot Bot’s White opening when the player starts as Black.",
      "Placed captured Black pieces with White and captured White pieces with Black.",
      "Added seven original illustrated theme backgrounds, including medieval army and moonlit castle styles, plus two new themes.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.5.0`,
  },
  {
    version: "0.4.1",
    date: "2026-07-24",
    title: "Viewport clearance",
    summary: "Short desktop and landscape layouts keep the board, replay, and controls usable.",
    changes: [
      "Kept the complete game board above the utility dock across common desktop heights.",
      "Preserved usable game and replay board sizes in short landscape viewports with vertical scrolling.",
      "Added clearance after the final mobile card and compacted replay controls around the board.",
      "Removed a duplicate checkmate announcement and made invalid deadline text neutral.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.4.1`,
  },
  {
    version: "0.4.0",
    date: "2026-07-24",
    title: "A more personal async game",
    summary: "Themes, replay, safe reactions, install support, and real move deadlines deepen every match.",
    changes: [
      "Added nine original themes for the app, board, pieces, panels, and background.",
      "Added an accessible visual picker that works from every route and synchronizes across tabs.",
      "Added six rate-limited, preset-only multiplayer reactions, a per-game hide control, and a 15-minute Good Game or Thanks courtesy window.",
      "Added a short theme-aware victory finisher with reduced-motion support.",
      "Added a read-only game replay with step controls and keyboard navigation.",
      "Added one, three, or five-day multiplayer move deadlines, defaulting to three days.",
      "Added installable PWA support, an unseen-release dot, and opt-in open-app opponent-move notifications.",
      "Made the exact release version visible on every route and state.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.4.0`,
  },
  {
    version: "0.3.5",
    date: "2026-07-24",
    title: "Instant move polish",
    summary: "Immediate solo moves now keep their sound and complete observability trail.",
    changes: [
      "Restored one accepted move or capture sound for the human ply.",
      "Restored game-completion telemetry when Riot Bot delivers the final move.",
      "Kept race telemetry limited to the move that actually committed.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.5`,
  },
  {
    version: "0.3.4",
    date: "2026-07-24",
    title: "Instant solo moves",
    summary: "Your piece now moves immediately while Riot Bot thinks in the background.",
    changes: [
      "Added a reversible local preview for every legal solo move before the server response arrives.",
      "Made the human move durable and visible before Riot Bot starts its reply.",
      "Added background bot-turn recovery so refresh or browser closure cannot strand a solo game.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.4`,
  },
  {
    version: "0.3.3",
    date: "2026-07-24",
    title: "Unmistakable piece colors",
    summary: "White and Black now use the same solid voxel-piece shapes with clearly contrasting colors.",
    changes: [
      "Replaced hollow White glyphs with solid light pieces so the player color cannot look inverted.",
      "Reduced the bright outline on Black pieces so they read as Black at a glance.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.3`,
  },
  {
    version: "0.3.2",
    date: "2026-07-24",
    title: "Laptop viewport polish",
    summary: "The complete board now stays inside a common laptop viewport at normal browser zoom.",
    changes: [
      "Tightened the desktop height cap after real-browser visual QA so the board no longer clips at the bottom.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.2`,
  },
  {
    version: "0.3.1",
    date: "2026-07-24",
    title: "A clearer, complete game board",
    summary: "The board now fits shorter screens, makes player colors and check unmistakable, and adds captured pieces and game-ending controls.",
    changes: [
      "Made the full board fit common laptop screens at normal browser zoom and increased important label sizes.",
      "Added explicit White and Black player cards plus captured-piece trays.",
      "Highlighted the checked king and explained exactly when a move fails to answer check.",
      "Added New Game and confirmed End Game or Cancel Game actions.",
      "Renamed computer difficulty to bot level.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.1`,
  },
  {
    version: "0.3.0",
    date: "2026-07-24",
    title: "A faster start and clearer releases",
    summary: "A much simpler home screen, visible board motion, in-app feedback, and a public version history.",
    changes: [
      "Simplified the new-game flow around name, mode, difficulty, and one primary action.",
      "Added short move and capture animations with reduced-motion support.",
      "Added a feedback form and an owner-only feedback pool.",
      "Added this changelog to every environment.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.3.0`,
  },
  {
    version: "0.2.2",
    date: "2026-07-24",
    title: "Correct solo turns and observability",
    summary: "Riot Bot can now play either color correctly, chess draw rules are more precise, and operations are visible per environment.",
    changes: [
      "Riot Bot opens automatically when it is White.",
      "Added claimable and automatic FIDE draw handling.",
      "Added privacy-safe health, action, error, and latency telemetry.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.2.2`,
  },
  {
    version: "0.2.1",
    date: "2026-07-24",
    title: "Version safety",
    summary: "Changed deployments can no longer silently reuse or decrease the app version.",
    changes: [
      "Added a single SemVer source and release commands.",
      "Added build-time checks for reused or inconsistent versions.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.2.1`,
  },
  {
    version: "0.2.0",
    date: "2026-07-24",
    title: "Solo play and drag controls",
    summary: "Play Riot Bot at five difficulty levels, or drag pieces in multiplayer.",
    changes: [
      "Added persistent solo games against Riot Bot.",
      "Added five difficulty levels with Medium as the default.",
      "Added mouse and touch drag-and-drop while preserving tap and keyboard input.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.2.0`,
  },
  {
    version: "0.1.2",
    date: "2026-07-24",
    title: "Portable private links",
    summary: "Private player links now work across computers and the game has a block-world visual identity.",
    changes: [
      "Embedded the private seat credential safely in the URL fragment.",
      "Added explicit private-link sharing and cross-device recovery.",
      "Restyled the complete experience with an original voxel-inspired look.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.1.2`,
  },
  {
    version: "0.1.1",
    date: "2026-07-24",
    title: "Identity, sound, and resilience",
    summary: "The first polish release added ChessRiot’s visual identity, game sounds, and reliability fixes.",
    changes: [
      "Added move, capture, check, result, and invalid-action sounds.",
      "Added mute controls, clearer loading, and safer local storage.",
      "Improved invitation, status, and promotion interactions.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.1.1`,
  },
  {
    version: "0.1.0",
    date: "2026-07-23",
    title: "Playable async chess",
    summary: "The first public prototype let two people create, join, resume, and finish a legal asynchronous chess game.",
    changes: [
      "Added one-use invitations and private player seats.",
      "Added complete standard chess rules and immutable move history.",
      "Added persistent two-device play with server-authoritative state.",
    ],
    githubUrl: `${REPOSITORY_URL}/tree/release/v0.1.0`,
  },
];

export const SOURCE_URL = REPOSITORY_URL;
