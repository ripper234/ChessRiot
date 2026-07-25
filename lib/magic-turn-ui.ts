import type { Square } from "chess.js";

export type RookDraftTapDecision = "move" | "select_rook" | "reject";

export function rookDraftTapDecision(
  rookSquare: Square,
  selected: Square | null,
  tapped: Square,
  legalDestinations: readonly Square[],
): RookDraftTapDecision {
  if (
    selected === rookSquare
    && legalDestinations.includes(tapped)
  ) {
    return "move";
  }
  return tapped === rookSquare ? "select_rook" : "reject";
}
