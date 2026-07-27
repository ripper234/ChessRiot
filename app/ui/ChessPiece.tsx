import type { PieceSymbol } from "chess.js";
import type { Color } from "@/lib/game-types";

interface ChessPieceProps {
  type: PieceSymbol;
  color: Color;
  className?: string;
}

function PieceShape({ type }: { type: PieceSymbol }) {
  switch (type) {
    case "p":
      return (
        <>
          <circle className="piece-silhouette" cx="50" cy="27" r="12" />
          <path
            className="piece-silhouette"
            d="M38 45c0-5 5-9 12-9s12 4 12 9c0 8-4 15-8 21H38c-4-6-8-13-8-21Z"
          />
          <path className="piece-silhouette" d="M31 63h38l6 14H25Z" />
          <path className="piece-silhouette" d="M21 77h58v11H21Z" />
        </>
      );
    case "r":
      return (
        <>
          <path
            className="piece-silhouette"
            d="M23 18h13v10h9V18h10v10h9V18h13v25H23Z"
          />
          <path className="piece-silhouette" d="M31 42h38l-4 31H35Z" />
          <path className="piece-silhouette" d="M27 69h46l5 10H22Z" />
          <path className="piece-silhouette" d="M19 79h62v10H19Z" />
          <path className="piece-detail" d="M31 43h38M35 69h30" />
        </>
      );
    case "n":
      return (
        <>
          <path
            className="piece-silhouette"
            d="M29 70c2-13 7-24 17-34l-4-13 15 6 12-10 9 19-3 20-18 13H43Z"
          />
          <path
            className="piece-silhouette"
            d="M29 68h41l7 12H22Z"
          />
          <path className="piece-silhouette" d="M19 79h62v10H19Z" />
          <circle className="piece-detail-fill" cx="62" cy="37" r="2.8" />
          <path className="piece-detail" d="M48 36c7 3 12 7 15 13" />
        </>
      );
    case "b":
      return (
        <>
          <path
            className="piece-silhouette"
            d="M50 16c10 10 16 19 16 28 0 8-6 15-16 21-10-6-16-13-16-21 0-9 6-18 16-28Z"
          />
          <path className="piece-detail" d="M58 27 43 49" />
          <path className="piece-silhouette" d="M34 61h32l8 17H26Z" />
          <path className="piece-silhouette" d="M21 78h58v11H21Z" />
        </>
      );
    case "q":
      return (
        <>
          <circle className="piece-silhouette" cx="20" cy="24" r="4" />
          <circle className="piece-silhouette" cx="35" cy="18" r="4" />
          <circle className="piece-silhouette" cx="50" cy="15" r="4" />
          <circle className="piece-silhouette" cx="65" cy="18" r="4" />
          <circle className="piece-silhouette" cx="80" cy="24" r="4" />
          <path
            className="piece-silhouette"
            d="m20 27 13 25 2-31 15 29 15-29 2 31 13-25-8 39H28Z"
          />
          <path className="piece-silhouette" d="M29 64h42l6 15H23Z" />
          <path className="piece-silhouette" d="M19 79h62v10H19Z" />
          <path className="piece-detail" d="M29 64h42" />
        </>
      );
    case "k":
      return (
        <>
          <path className="piece-silhouette" d="M46 10h8v12h11v8H54v12h-8V30H35v-8h11Z" />
          <path
            className="piece-silhouette"
            d="M31 39c5-6 11-9 19-9s14 3 19 9l-7 19H38Z"
          />
          <path className="piece-silhouette" d="M37 55h26l9 22H28Z" />
          <path className="piece-silhouette" d="M21 77h58v12H21Z" />
          <path className="piece-detail" d="M38 55h24" />
        </>
      );
  }
}

export function ChessPiece({ type, color, className = "" }: ChessPieceProps) {
  const classes = ["chess-piece-svg", `piece-${color}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={classes}
      data-piece={type}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <PieceShape type={type} />
    </svg>
  );
}
