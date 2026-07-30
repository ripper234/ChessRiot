export const GAME_VARIANT_IDS = [
  "standard",
  "pawn-riot",
  "half-army",
  "pawn-duel",
  "mate-pawn",
  "mate-rook",
  "mate-two-bishops",
] as const;

export type GameVariantId = (typeof GAME_VARIANT_IDS)[number];
export type GameVariantGroup = "classic" | "mini-game" | "mating-set";

export interface GameVariantDefinition {
  id: GameVariantId;
  name: string;
  loadout: string;
  description: string;
  initialFen: string;
  icon: string;
  miniGame: boolean;
  group: GameVariantGroup;
  soloOnly: boolean;
  humanColor: "w" | null;
}

export const GAME_VARIANTS: readonly GameVariantDefinition[] = [
  {
    id: "standard",
    name: "Classic Chess",
    loadout: "Full army",
    description: "The complete board. Checkmate wins.",
    initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    icon: "♜",
    miniGame: false,
    group: "classic",
    soloOnly: false,
    humanColor: null,
  },
  {
    id: "pawn-riot",
    name: "Pawn Riot",
    loadout: "King + 8 pawns",
    description: "Promote a pawn, build an army, and checkmate.",
    initialFen: "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1",
    icon: "♟",
    miniGame: true,
    group: "mini-game",
    soloOnly: false,
    humanColor: null,
  },
  {
    id: "half-army",
    name: "Half Army",
    loadout: "Half the pieces",
    description: "King, rook, bishop, knight, and four pawns.",
    initialFen: "rnb1k3/pppp4/8/8/8/8/PPPP4/RNB1K3 w - - 0 1",
    icon: "½",
    miniGame: true,
    group: "mini-game",
    soloOnly: false,
    humanColor: null,
  },
  {
    id: "pawn-duel",
    name: "Pawn Duel",
    loadout: "King + 3 pawns",
    description: "A tiny, tactical race to promote and checkmate.",
    initialFen: "4k3/2ppp3/8/8/8/8/2PPP3/4K3 w - - 0 1",
    icon: "⚔",
    miniGame: true,
    group: "mini-game",
    soloOnly: false,
    humanColor: null,
  },
  {
    id: "mate-pawn",
    name: "Pawn Promotion",
    loadout: "King + pawn vs king",
    description: "Use opposition, promote the pawn, then checkmate.",
    initialFen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
    icon: "♙",
    miniGame: true,
    group: "mating-set",
    soloOnly: true,
    humanColor: "w",
  },
  {
    id: "mate-rook",
    name: "Rook Mate",
    loadout: "King + rook vs king",
    description: "Build a shrinking box, reach the edge, and mate.",
    initialFen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    icon: "♖",
    miniGame: true,
    group: "mating-set",
    soloOnly: true,
    humanColor: "w",
  },
  {
    id: "mate-two-bishops",
    name: "Two-Bishop Mate",
    loadout: "King + 2 bishops vs king",
    description: "Coordinate both bishops and your king to force mate.",
    initialFen: "4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1",
    icon: "♗",
    miniGame: true,
    group: "mating-set",
    soloOnly: true,
    humanColor: "w",
  },
] as const;

const VARIANT_BY_ID = new Map(
  GAME_VARIANTS.map((variant) => [variant.id, variant]),
);

export function isGameVariantId(value: unknown): value is GameVariantId {
  return typeof value === "string" && VARIANT_BY_ID.has(value as GameVariantId);
}

export function normalizeGameVariantId(value: unknown): GameVariantId {
  return isGameVariantId(value) ? value : "standard";
}

export function gameVariant(value: unknown): GameVariantDefinition {
  return VARIANT_BY_ID.get(normalizeGameVariantId(value)) ?? GAME_VARIANTS[0];
}
