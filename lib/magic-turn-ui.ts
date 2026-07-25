import type { Square } from "chess.js";

export type MagicDraftTapDecision = "move" | "select_piece" | "reject";

export function magicDraftTapDecision(
  pieceSquare: Square,
  selected: Square | null,
  tapped: Square,
  legalDestinations: readonly Square[],
): MagicDraftTapDecision {
  if (
    selected === pieceSquare
    && legalDestinations.includes(tapped)
  ) {
    return "move";
  }
  return tapped === pieceSquare ? "select_piece" : "reject";
}
