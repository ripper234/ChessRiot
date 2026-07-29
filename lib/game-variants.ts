export const GAME_VARIANT_IDS = [
  "standard",
  "pawn-riot",
  "half-army",
  "pawn-duel",
] as const;

export type GameVariantId = (typeof GAME_VARIANT_IDS)[number];

export interface GameVariantDefinition {
  id: GameVariantId;
  name: string;
  loadout: string;
  description: string;
  initialFen: string;
  icon: string;
  miniGame: boolean;
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
  },
  {
    id: "pawn-riot",
    name: "Pawn Riot",
    loadout: "King + 8 pawns",
    description: "Promote a pawn, build an army, and checkmate.",
    initialFen: "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1",
    icon: "♟",
    miniGame: true,
  },
  {
    id: "half-army",
    name: "Half Army",
    loadout: "Half the pieces",
    description: "King, rook, bishop, knight, and four pawns.",
    initialFen: "rnb1k3/pppp4/8/8/8/8/PPPP4/RNB1K3 w - - 0 1",
    icon: "½",
    miniGame: true,
  },
  {
    id: "pawn-duel",
    name: "Pawn Duel",
    loadout: "King + 3 pawns",
    description: "A tiny, tactical race to promote and checkmate.",
    initialFen: "4k3/2ppp3/8/8/8/8/2PPP3/4K3 w - - 0 1",
    icon: "⚔",
    miniGame: true,
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
