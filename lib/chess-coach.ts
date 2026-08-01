import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { MoveIntent } from "./move-confirmation";

export const CHESS_COACH_PREFERENCE_KEY = "chessriot:chess-coach";
export const TACTICAL_CELEBRATIONS_PREFERENCE_KEY = "chessriot:tactical-celebrations";

export interface CoachWarning {
  explanation: string;
}

export interface GreatMoveInsight {
  kind: "fork" | "material";
  label: string;
}

const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAMES: Record<PieceSymbol, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function readChessCoachPreference(storage?: StorageReader | null): boolean {
  if (storage === null) return true;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return target?.getItem(CHESS_COACH_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeChessCoachPreference(enabled: boolean, storage?: StorageWriter | null): void {
  if (storage === null) return;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    target?.setItem(CHESS_COACH_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // The coach still uses the current-tab setting.
  }
}

export function readTacticalCelebrationsPreference(storage?: StorageReader | null): boolean {
  if (storage === null) return true;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return target?.getItem(TACTICAL_CELEBRATIONS_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeTacticalCelebrationsPreference(enabled: boolean, storage?: StorageWriter | null): void {
  if (storage === null) return;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    target?.setItem(TACTICAL_CELEBRATIONS_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // The current tab keeps the selected behavior.
  }
}

function forceTurn(fen: string, color: "w" | "b"): string {
  const fields = fen.split(" ");
  if (fields.length !== 6) return fen;
  fields[1] = color;
  return fields.join(" ");
}

function applyIntent(chess: Chess, intent: MoveIntent) {
  const first = chess.move({
    from: intent.from,
    to: intent.to,
    ...(intent.promotion ? { promotion: intent.promotion } : {}),
  });
  if (!intent.second) return { chess, first, final: first };
  const secondChess = new Chess(forceTurn(chess.fen(), first.color));
  const second = secondChess.move({ from: intent.second.from, to: intent.second.to });
  return { chess: secondChess, first, final: second };
}

export function analyzeMoveRisk(fen: string, intent: MoveIntent): CoachWarning | null {
  try {
    const chess = new Chess(fen);
    const moving = chess.get(intent.from);
    if (!moving) return null;
    const result = applyIntent(chess, intent);
    const after = result.chess;
    if (after.isCheckmate()) return null;
    const immediateGain = (result.first.captured ? VALUES[result.first.captured] : 0)
      + (result.final !== result.first && result.final.captured ? VALUES[result.final.captured] : 0);
    const destination = (intent.second?.to ?? intent.to) as Square;
    const finalPiece = after.get(destination);
    if (!finalPiece || finalPiece.color !== moving.color) return null;

    let best: { loss: number; attacker: PieceSymbol } | null = null;
    for (const reply of after.moves({ verbose: true })) {
      if (!reply.captured || reply.to !== destination) continue;
      const replyBoard = new Chess(after.fen());
      replyBoard.move({
        from: reply.from,
        to: reply.to,
        ...(reply.promotion ? { promotion: reply.promotion } : {}),
      });
      const canRecapture = replyBoard.moves({ verbose: true })
        .some((candidate) => candidate.captured && candidate.to === destination);
      // Compensation is the value of the enemy attacker that can be won back,
      // not the value of our recapturing piece. Using the latter made a queen
      // recapture incorrectly erase an otherwise real material loss.
      const recaptureValue = canRecapture ? VALUES[reply.piece] : 0;
      const loss = VALUES[finalPiece.type] - immediateGain - recaptureValue;
      if (loss < 2 || (best && best.loss >= loss)) continue;
      best = { loss, attacker: reply.piece };
    }
    if (!best) return null;
    return {
      explanation: `This leaves your ${NAMES[finalPiece.type]} on ${destination}, where an enemy ${NAMES[best.attacker]} can capture it next move without enough compensation.`,
    };
  } catch {
    return null;
  }
}

export function analyzeGreatMove(fen: string, intent: MoveIntent): GreatMoveInsight | null {
  try {
    const before = new Chess(fen);
    const moving = before.get(intent.from);
    if (!moving) return null;
    const result = applyIntent(before, intent);
    const after = result.chess;
    if (after.isCheckmate()) return null;
    const destination = (intent.second?.to ?? intent.to) as Square;
    const finalPiece = after.get(destination);
    if (!finalPiece) return null;

    const gained = (result.first.captured ? VALUES[result.first.captured] : 0)
      + (result.final !== result.first && result.final.captured ? VALUES[result.final.captured] : 0);
    if (gained - VALUES[moving.type] >= 2) {
      return { kind: "material", label: "GREAT WIN" };
    }

    const moverBoard = new Chess(forceTurn(after.fen(), moving.color));
    const valuableTargets = moverBoard.moves({ square: destination, verbose: true })
      .filter((candidate) => candidate.captured && VALUES[candidate.captured] >= 3)
      .map((candidate) => candidate.to);
    // chess.js represents check without a pseudo-move that captures the king,
    // so count check itself as the second target in a king-and-piece fork.
    const targetCount = new Set(valuableTargets).size + (after.isCheck() ? 1 : 0);
    if (targetCount >= 2) {
      return { kind: "fork", label: "FORK!" };
    }
    return null;
  } catch {
    return null;
  }
}
