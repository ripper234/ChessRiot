import type { PieceSymbol } from "chess.js";
import type { Color } from "@/lib/game-types";
import { ChessPiece } from "./ChessPiece";

const BACK_RANK: PieceSymbol[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
const PUBLIC_POSITION: Array<{ type: PieceSymbol; color: Color; motion?: string } | null> = [
  ...BACK_RANK.map((type, index) => ({
    type,
    color: "b" as const,
    ...(index === 1 ? { motion: "home-move-b8-c6" } : {}),
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    type: "p" as const,
    color: "b" as const,
    ...(index === 4 ? { motion: "home-move-e7-e5" } : {}),
  })),
  ...Array.from({ length: 32 }, () => null),
  ...Array.from({ length: 8 }, (_, index) => ({
    type: "p" as const,
    color: "w" as const,
    ...(index === 4 ? { motion: "home-move-e2-e4" } : {}),
  })),
  ...BACK_RANK.map((type, index) => ({
    type,
    color: "w" as const,
    ...(index === 6 ? { motion: "home-move-g1-f3" } : {}),
  })),
];

export function AnimatedPublicBoard() {
  return (
    <div className="public-board" aria-label="Animated chess opening preview" role="img">
      {PUBLIC_POSITION.map((piece, index) => (
        <span key={index}>
          {piece ? (
            <i className={piece.motion ?? undefined}>
              <ChessPiece type={piece.type} color={piece.color} />
            </i>
          ) : null}
        </span>
      ))}
    </div>
  );
}
