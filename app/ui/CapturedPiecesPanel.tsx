import type { PieceSymbol } from "chess.js";
import { CHESS_PIECE_NAMES } from "@/lib/game-presentation";
import { ChessPiece } from "./ChessPiece";

function PieceList({ pieces, color }: { pieces: PieceSymbol[]; color: "w" | "b" }) {
  return pieces.length ? (
    <span className={`captured-piece-list piece-${color}`} data-captured-count={pieces.length} role="list">
      {pieces.map((piece, index) => (
        <i key={`${color}-${piece}-${index}`} role="listitem" aria-label={`${color === "w" ? "White" : "Black"} ${CHESS_PIECE_NAMES[piece]}`}>
          <ChessPiece type={piece} color={color} />
        </i>
      ))}
    </span>
  ) : <span className="captured-none">None yet</span>;
}

export function CapturedPiecesPanel({
  whiteCaptured,
  blackCaptured,
}: {
  whiteCaptured: PieceSymbol[];
  blackCaptured: PieceSymbol[];
}) {
  return (
    <section className="side-card captured-pieces-panel" dir="ltr" aria-labelledby="captured-pieces-title">
      <h2 id="captured-pieces-title">Captured pieces</h2>
      <div><strong>Captured by White</strong><PieceList pieces={blackCaptured} color="b" /></div>
      <div><strong>Captured by Black</strong><PieceList pieces={whiteCaptured} color="w" /></div>
    </section>
  );
}
