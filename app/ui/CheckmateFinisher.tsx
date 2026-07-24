import type { PieceSymbol } from "chess.js";
import type { GameFinisher } from "@/lib/game-finishers";

const PIECES: Record<"w" | "b", Record<PieceSymbol, string>> = {
  w: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

export function CheckmateFinisher({ finisher }: { finisher: GameFinisher }) {
  return (
    <div
      className={`checkmate-finisher winner-${finisher.winner}`}
      aria-hidden="true"
    >
      <div className="checkmate-duel" aria-hidden="true">
        <span className={`finisher-piece finisher-attacker piece-${finisher.winner}`}>
          {PIECES[finisher.winner][finisher.attackingPiece]}
        </span>
        <span className="finisher-impact">✦</span>
        <span className={`finisher-piece finisher-king piece-${finisher.loser}`}>
          {PIECES[finisher.loser].k}
        </span>
      </div>
      <strong>CHECKMATE</strong>
    </div>
  );
}
