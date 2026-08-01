import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { Color, GameSnapshot, Promotion, PublicMove } from "./game-types";

export interface EffectPiece {
  color: Color;
  type: PieceSymbol;
}

export interface CapturedEffectPiece extends EffectPiece {
  square: string;
}

export interface BoardEffect {
  id: string;
  ply: number;
  leg: "first" | "second";
  from: string;
  to: string;
  capture: boolean;
  beforeFen: string;
  afterFen: string;
  attacker: EffectPiece | null;
  victim: CapturedEffectPiece | null;
}

function forceSameTurn(fen: string, color: Color): string {
  const fields = fen.split(" ");
  if (fields.length !== 6) throw new Error("Chess position is invalid");
  fields[1] = color;
  if (color === "b") {
    fields[5] = String(Math.max(1, Number(fields[5] ?? "1") - 1));
  }
  return fields.join(" ");
}

function capturedSquare(from: string, to: string, enPassant: boolean): string {
  return enPassant ? `${to[0]}${from[1]}` : to;
}

function applyEffectLeg(
  chess: Chess,
  stored: PublicMove,
  leg: "first" | "second",
  from: string,
  to: string,
  promotion?: Promotion,
): BoardEffect {
  const beforeFen = chess.fen();
  const attacker = chess.get(from as Square) ?? null;
  const move = chess.move({
    from,
    to,
    ...(promotion ? { promotion } : {}),
  });
  const victim = move.captured
    ? {
      color: move.color === "w" ? "b" as const : "w" as const,
      type: move.captured,
      square: capturedSquare(from, to, move.isEnPassant()),
    }
    : null;

  return {
    id: `${stored.ply}:${leg}:${from}-${to}`,
    ply: stored.ply,
    leg,
    from,
    to,
    capture: Boolean(victim),
    beforeFen,
    afterFen: chess.fen(),
    attacker: attacker
      ? { color: attacker.color as Color, type: attacker.type }
      : null,
    victim,
  };
}

export function moveBoardEffects(
  stored: PublicMove,
  fallbackFen: string,
): BoardEffect[] {
  try {
    const chess = new Chess(stored.fenBefore ?? fallbackFen);
    const effects = [
      applyEffectLeg(
        chess,
        stored,
        "first",
        stored.from,
        stored.to,
        stored.promotion ?? undefined,
      ),
    ];

    if (stored.second) {
      const secondChess = new Chess(forceSameTurn(chess.fen(), stored.color));
      effects.push(applyEffectLeg(
        secondChess,
        stored,
        "second",
        stored.second.from,
        stored.second.to,
      ));
    }

    const finalEffect = effects.at(-1);
    if (finalEffect && stored.fenAfter) finalEffect.afterFen = stored.fenAfter;
    return effects;
  } catch {
    // Combat is presentation-only. Old or malformed history must never block
    // the authoritative board.
    return [];
  }
}

export function boardEffects(
  previous: GameSnapshot | null,
  next: GameSnapshot,
): BoardEffect[] {
  if (!previous || next.plyCount <= previous.plyCount) return [];
  let fallbackFen = previous.fen;
  const effects: BoardEffect[] = [];
  for (const move of next.moves.filter((candidate) => candidate.ply > previous.plyCount)) {
    const moveEffects = moveBoardEffects(move, fallbackFen);
    effects.push(...moveEffects);
    fallbackFen = move.fenAfter ?? moveEffects.at(-1)?.afterFen ?? fallbackFen;
  }
  return effects;
}
