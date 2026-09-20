import type { PieceSymbol } from "chess.js";
import { HEBREW_CHESS_PIECE_NAMES } from "@/lib/game-presentation";
import { ChessPiece } from "./ChessPiece";

function PieceList({ pieces, color }: { pieces: PieceSymbol[]; color: "w" | "b" }) {
  return pieces.length ? (
    <span className={`captured-piece-list piece-${color}`} data-captured-count={pieces.length} role="list">
      {pieces.map((piece, index) => (
        <i key={`${color}-${piece}-${index}`} role="listitem" aria-label={`${color === "w" ? "לבן" : "שחור"} ${HEBREW_CHESS_PIECE_NAMES[piece]}`}>
          <ChessPiece type={piece} color={color} />
        </i>
      ))}
    </span>
  ) : <span className="captured-none">עדיין אין</span>;
}

export function CapturedPiecesPanel({
  whiteCaptured,
  blackCaptured,
}: {
  whiteCaptured: PieceSymbol[];
  blackCaptured: PieceSymbol[];
}) {
  return (
    <section className="side-card captured-pieces-panel" dir="rtl" aria-labelledby="captured-pieces-title">
      <h2 id="captured-pieces-title">כלים שנלקחו</h2>
      <div><strong>נלקחו בידי לבן</strong><PieceList pieces={blackCaptured} color="b" /></div>
      <div><strong>נלקחו בידי שחור</strong><PieceList pieces={whiteCaptured} color="w" /></div>
    </section>
  );
}
