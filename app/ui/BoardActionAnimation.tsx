import type { CSSProperties } from "react";
import type { PieceSymbol, Square } from "chess.js";
import type { BoardEffect } from "@/lib/game-effects";
import { ChessPiece } from "./ChessPiece";

export const MOVE_ACTION_MS = 220;
export const CAPTURE_ACTION_MS = 560;
export const REDUCED_ACTION_MS = 120;

interface BoardActionAnimationProps {
  effect: BoardEffect;
  squares: Square[];
  reducedMotion?: boolean;
  onComplete?: () => void;
}

function squareCoordinates(squares: Square[], square: string): [number, number] | null {
  const index = squares.indexOf(square as Square);
  if (index < 0) return null;
  return [index % 8, Math.floor(index / 8)];
}

function victimReaction(type: PieceSymbol, dx: number, dy: number): [number, number, number] {
  const horizontal = dx === 0 ? 1 : Math.sign(dx);
  const vertical = dy === 0 ? -1 : Math.sign(dy);
  switch (type) {
    case "n": return [horizontal * 10, vertical * 48, horizontal * 22];
    case "b": return [horizontal * 38, vertical * 20, horizontal * 72];
    case "r": return [horizontal * 50, vertical * 7, horizontal * 34];
    case "q": return [horizontal * 34, vertical * 30, horizontal * 118];
    case "k": return [horizontal * 18, vertical * 42, horizontal * 84];
    default: return [horizontal * 28, vertical * 17, horizontal * 58];
  }
}

export function boardActionDuration(effect: BoardEffect, reducedMotion = false): number {
  if (reducedMotion) return REDUCED_ACTION_MS;
  return effect.capture ? CAPTURE_ACTION_MS : MOVE_ACTION_MS;
}

function actionStyle(
  effect: BoardEffect,
  squares: Square[],
  reducedMotion: boolean,
): CSSProperties {
  const from = squareCoordinates(squares, effect.from);
  const to = squareCoordinates(squares, effect.to);
  const victim = squareCoordinates(squares, effect.victim?.square ?? effect.to);
  if (!from || !to || !victim || !effect.attacker) return {};

  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const arcDirection = from[1] < 2 ? 1 : -1;
  const arcHeight = Math.min(126, 68 + distance * 10);
  const [kickX, kickY, victimSpin] = victimReaction(effect.attacker.type, dx, dy);

  return {
    "--action-from-x": `${from[0] * 12.5}%`,
    "--action-from-y": `${from[1] * 12.5}%`,
    "--action-x": `${dx * 100}%`,
    "--action-y": `${dy * 100}%`,
    "--action-half-x": `${dx * 50}%`,
    "--action-half-y": `${dy * 50}%`,
    "--action-arc-y": `${arcDirection * arcHeight}%`,
    "--action-angle": `${angle}deg`,
    "--action-facing": dx < 0 ? -1 : 1,
    "--victim-x": `${victim[0] * 12.5}%`,
    "--victim-y": `${victim[1] * 12.5}%`,
    "--victim-kick-x": `${kickX}%`,
    "--victim-kick-y": `${kickY}%`,
    "--victim-spin": `${victimSpin}deg`,
    "--action-duration": `${boardActionDuration(effect, reducedMotion)}ms`,
  } as CSSProperties;
}

const CHIP_ANGLES = [-78, -42, -8, 28, 66, 104, 146, 184];

export function BoardActionAnimation({
  effect,
  squares,
  reducedMotion = false,
  onComplete,
}: BoardActionAnimationProps) {
  if (!effect.attacker) return null;

  return (
    <div
      className={`board-action-animation${effect.capture ? " is-capture" : " is-move"}${reducedMotion ? " is-reduced" : ""}`}
      data-attacker={effect.attacker.type}
      data-effect-id={effect.id}
      data-victim={effect.victim?.type ?? undefined}
      style={actionStyle(effect, squares, reducedMotion)}
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) onComplete?.();
      }}
    >
      <span className={`action-unit action-attacker piece-${effect.attacker.color}`}>
        <span className="action-piece-body">
          <ChessPiece type={effect.attacker.type} color={effect.attacker.color} />
          {effect.capture ? <i className="action-weapon" /> : null}
        </span>
        <i className="action-trail" />
      </span>

      {effect.victim ? (
        <span className={`action-unit action-victim piece-${effect.victim.color}`}>
          <ChessPiece type={effect.victim.type} color={effect.victim.color} />
        </span>
      ) : null}

      {effect.capture ? (
        <span className="action-impact">
          <i className="action-impact-ring" />
          <i className="action-impact-sweep" />
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

      <span className="action-reduced-marker">✦</span>
    </div>
  );
}
