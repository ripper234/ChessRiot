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
