import type { PieceSymbol, Square } from "chess.js";
import type { GameSnapshot, Promotion } from "./game-types";

export const MOVE_CONFIRMATION_PREFERENCE_KEY = "chessriot:confirm-every-move";

export interface MoveIntent {
  from: Square;
  to: Square;
  promotion?: Promotion;
  second?: {
    from: Square;
    to: Square;
  };
  continuation?: Array<{
    from: Square;
    to: Square;
    promotion?: Promotion;
  }>;
  expectedVersion: number;
  piece: PieceSymbol | null;
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const PROMOTION_NAMES: Record<Promotion, string> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
};

export function readMoveConfirmationPreference(
  storage?: StorageReader | null,
): boolean {
  if (storage === null) return false;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return target?.getItem(MOVE_CONFIRMATION_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeMoveConfirmationPreference(
  enabled: boolean,
  storage?: StorageWriter | null,
): void {
  if (storage === null) return;
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    target?.setItem(MOVE_CONFIRMATION_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // The preference still applies in this tab when browser storage is unavailable.
  }
}

export function describeMoveIntent(intent: MoveIntent): string {
  const piece = intent.piece ? PIECE_NAMES[intent.piece] : "piece";
  const continuation = intent.continuation
    ?? (intent.second ? [intent.second] : []);
  const route = [intent.from, intent.to, ...continuation.map((leg) => leg.to)]
    .join(" → ");
  const promotion = intent.promotion
    ? ` and promote to ${PROMOTION_NAMES[intent.promotion]}`
    : "";
  return `Move ${piece} ${route}${promotion}?`;
}

export function moveIntentStillValid(
  intent: MoveIntent,
  game: Pick<GameSnapshot, "version" | "status" | "turn" | "you"> | null,
): boolean {
  return Boolean(
    game
    && game.version === intent.expectedVersion
    && game.status === "active"
    && game.turn === game.you.color,
  );
}
