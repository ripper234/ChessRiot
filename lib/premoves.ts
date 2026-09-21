import type { Color, Promotion } from "./game-types";
import type { GameRow } from "./game-store";
import { isPromotion, isSquare } from "./game-rules";
import { isUuid } from "./validation";

export interface PremoveIntent { from: string; to: string; promotion?: Promotion }
export interface PremoveState {
  revision: number;
  status: "none" | "queued" | "cancelled" | "played" | "invalid";
  requestId: string | null;
  accountId: string | null;
  version: number;
  move: PremoveIntent | null;
}
export function premoveColumn(color: Color): "white_premove_json" | "black_premove_json" {
  return color === "w" ? "white_premove_json" : "black_premove_json";
}
export function readPremove(game: GameRow, color: Color): PremoveState {
  const empty: PremoveState = { revision: 0, status: "none", requestId: null, accountId: null, version: game.version, move: null };
  try {
    const data = JSON.parse(game[premoveColumn(color)] ?? "null") as PremoveState | null;
    if (!data || !Number.isSafeInteger(data.revision) || data.revision < 1 || !isUuid(data.requestId)) return empty;
    return data;
  } catch { return empty; }
}
export function validPremove(value: unknown): value is PremoveIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const move = value as PremoveIntent;
  return isSquare(move.from) && isSquare(move.to) && move.from !== move.to
    && (move.promotion === undefined || isPromotion(move.promotion))
    && Object.keys(move).every(key => ["from", "to", "promotion"].includes(key));
}
export function visiblePremove(game: GameRow, color: Color) {
  const state = readPremove(game, color);
  return { revision: state.revision, status: state.status === "invalid" && game.version > state.version + 1 ? "none" as const : state.status,
    move: game.status === "active" && game.turn_color !== color && state.version === game.version
      && state.status === "queued" ? state.move : null };
}
