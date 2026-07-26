import type { GameFinisher } from "@/lib/game-finishers";
import { CHESS_PIECE_GLYPHS } from "@/lib/game-presentation";

export function CheckmateFinisher({ finisher }: { finisher: GameFinisher }) {
  return (
    <div
      className={`checkmate-finisher winner-${finisher.winner}`}
      aria-hidden="true"
    >
      <div className="checkmate-duel" aria-hidden="true">
        <span className={`finisher-piece finisher-attacker piece-${finisher.winner}`}>
          {CHESS_PIECE_GLYPHS[finisher.winner][finisher.attackingPiece]}
        </span>
        <span className="finisher-impact">✦</span>
        <span className={`finisher-piece finisher-king piece-${finisher.loser}`}>
          {CHESS_PIECE_GLYPHS[finisher.loser].k}
        </span>
      </div>
      <strong>CHECKMATE</strong>
    </div>
  );
}
