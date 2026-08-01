import type { Color } from "@/lib/game-types";
import { ChessPiece } from "./ChessPiece";

export function ResignationFinisher({ color }: { color: Color }) {
  return (
    <div className="resignation-finisher" aria-hidden="true">
      <div className={`resignation-king piece-${color}`}>
        <ChessPiece type="k" color={color} />
        <span className="white-flag"><i /></span>
      </div>
      <strong>SURRENDER</strong>
    </div>
  );
}
