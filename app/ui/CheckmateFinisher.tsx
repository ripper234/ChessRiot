import type { GameFinisher } from "@/lib/game-finishers";
import { ChessPiece } from "./ChessPiece";

export function CheckmateFinisher({ finisher }: { finisher: GameFinisher }) {
  return (
    <div
      className={`checkmate-finisher winner-${finisher.winner}`}
      aria-hidden="true"
    >
      <div className="checkmate-duel" aria-hidden="true">
        <span className="finisher-piece finisher-attacker">
          <ChessPiece type={finisher.attackingPiece} color={finisher.winner} />
        </span>
        <span className="finisher-impact">✦</span>
        <span className="finisher-piece finisher-king">
          <ChessPiece type="k" color={finisher.loser} />
        </span>
      </div>
      <strong>CHECKMATE</strong>
    </div>
  );
}
