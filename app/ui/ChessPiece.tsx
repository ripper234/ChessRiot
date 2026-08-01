"use client";

import type { PieceSymbol } from "chess.js";
import type { Color } from "@/lib/game-types";
import type { ThemeId } from "@/lib/themes";
import { useCurrentTheme } from "@/lib/theme-store";
import { ThemedPieceArtwork } from "./ThemedPieceArtwork";

interface ChessPieceProps {
  type: PieceSymbol;
  color: Color;
  className?: string;
  theme?: ThemeId;
}
export function ChessPiece({ type, color, className = "", theme }: ChessPieceProps) {
  const currentTheme = useCurrentTheme();
  const artworkTheme = theme ?? currentTheme;
  const classes = ["chess-piece-svg", `piece-${color}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={classes}
      data-piece={type}
      data-piece-theme={artworkTheme}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <ThemedPieceArtwork type={type} theme={artworkTheme} />
    </svg>
  );
}
