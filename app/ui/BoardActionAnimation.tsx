import type { CSSProperties } from "react";
import type { Square } from "chess.js";
import type { BoardEffect } from "@/lib/game-effects";
import { ChessPiece } from "./ChessPiece";

interface BoardActionAnimationProps {
  effect: BoardEffect;
  squares: Square[];
  reducedMotion?: boolean;
}

function squareCoordinates(squares: Square[], square: string): [number, number] | null {
  const index = squares.indexOf(square as Square);
  if (index < 0) return null;
  return [index % 8, Math.floor(index / 8)];
}

function actionStyle(effect: BoardEffect, squares: Square[]): CSSProperties {
  const from = squareCoordinates(squares, effect.from);
  const to = squareCoordinates(squares, effect.to);
  const victim = squareCoordinates(squares, effect.victim?.square ?? effect.to);
  if (!from || !to || !victim) return {};

  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const kickX = dx === 0 ? 18 : Math.sign(dx) * 24;
  const kickY = dy === 0 ? -10 : Math.sign(dy) * 16;

  return {
    "--action-from-x": `${from[0] * 12.5}%`,
    "--action-from-y": `${from[1] * 12.5}%`,
    "--action-x": `${dx * 100}%`,
    "--action-y": `${dy * 100}%`,
    "--action-half-x": `${dx * 50}%`,
    "--action-half-y": `${dy * 50}%`,
    "--action-arc": `${Math.min(112, 58 + distance * 11)}%`,
    "--action-angle": `${angle}deg`,
    "--action-facing": dx < 0 ? -1 : 1,
    "--victim-x": `${victim[0] * 12.5}%`,
    "--victim-y": `${victim[1] * 12.5}%`,
    "--victim-kick-x": `${kickX}%`,
    "--victim-kick-y": `${kickY}%`,
  } as CSSProperties;
}

const CHIP_ANGLES = [-72, -28, 18, 62, 116, 158];

export function BoardActionAnimation({
  effect,
  squares,
  reducedMotion = false,
}: BoardActionAnimationProps) {
  if (!effect.attacker) return null;

  return (
    <div
      className={`board-action-animation${effect.capture ? " is-capture" : " is-move"}${reducedMotion ? " is-reduced" : ""}`}
      data-attacker={effect.attacker.type}
      data-effect-id={effect.id}
      data-victim={effect.victim?.type ?? undefined}
      style={actionStyle(effect, squares)}
      aria-hidden="true"
    >
      <span className={`action-unit action-attacker piece-${effect.attacker.color}`}>
        <ChessPiece type={effect.attacker.type} color={effect.attacker.color} />
        {effect.capture ? <i className="action-weapon" /> : null}
      </span>

      {effect.victim ? (
        <span className={`action-unit action-victim piece-${effect.victim.color}`}>
          <ChessPiece type={effect.victim.type} color={effect.victim.color} />
        </span>
      ) : null}

      {effect.capture ? (
        <span className="action-impact">
          <i className="action-impact-ring" />
          <b>✦</b>
          {CHIP_ANGLES.map((angle) => (
            <i
              className="action-chip"
              key={angle}
              style={{ "--chip-angle": `${angle}deg` } as CSSProperties}
            />
          ))}
        </span>
      ) : null}

      <span className="action-reduced-marker" />
    </div>
  );
}
