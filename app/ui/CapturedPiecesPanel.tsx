"use client";

import { useLanguage } from "./LanguageProvider";
import type { PieceSymbol } from "chess.js";
import { CHESS_PIECE_NAMES } from "@/lib/game-presentation";
import { ChessPiece } from "./ChessPiece";

function PieceList({ pieces, color }: { pieces: PieceSymbol[]; color: "w" | "b" }) {
  const { t } = useLanguage();
  return pieces.length ? (
    <span className={`captured-piece-list piece-${color}`} data-captured-count={pieces.length} role="list">
      {pieces.map((piece, index) => (
        <i key={`${color}-${piece}-${index}`} role="listitem" aria-label={t("${p0} ${p1}", {p0: t(color === "w" ? "White" : "Black"), p1: t(CHESS_PIECE_NAMES[piece])})}>
          <ChessPiece type={piece} color={color} />
        </i>
      ))}
    </span>
  ) : <span className="captured-none">{t("None yet")}</span>;
}

export function CapturedPiecesPanel({
  whiteCaptured,
  blackCaptured,
}: {
  whiteCaptured: PieceSymbol[];
  blackCaptured: PieceSymbol[];
}) {
  const { locale, dir, t } = useLanguage();
  return (
    <section className="side-card captured-pieces-panel" dir={dir} lang={locale} aria-labelledby="captured-pieces-title">
      <h2 id="captured-pieces-title">{t("Captured pieces")}</h2>
      <div><strong>{t("Captured by White")}</strong><PieceList pieces={blackCaptured} color="b" /></div>
      <div><strong>{t("Captured by Black")}</strong><PieceList pieces={whiteCaptured} color="w" /></div>
    </section>
  );
}
