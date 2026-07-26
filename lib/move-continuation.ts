import type { Move } from "chess.js";
import type { MoveContinuation, Promotion } from "./game-types";

function isPromotion(value: unknown): value is Promotion {
  return value === "q" || value === "r" || value === "b" || value === "n";
}

function isSquare(value: unknown): value is string {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

export function serializeMoveContinuation(moves: Move[]): string {
  return JSON.stringify(moves.map((move) => ({
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}),
    san: move.san,
  })));
}

export function parseMoveContinuation(value: string | null | undefined): MoveContinuation[] {
  if (value === null || value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored move continuation is invalid");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length > 5
    || !parsed.every((leg) => {
      if (!leg || typeof leg !== "object" || Array.isArray(leg)) return false;
      const candidate = leg as {
        from?: unknown;
        to?: unknown;
        promotion?: unknown;
        san?: unknown;
      };
      return isSquare(candidate.from)
        && isSquare(candidate.to)
        && (candidate.promotion === undefined || candidate.promotion === null
          || isPromotion(candidate.promotion))
        && typeof candidate.san === "string"
        && candidate.san.length > 0
        && candidate.san.length <= 32;
    })
  ) {
    throw new Error("Stored move continuation is invalid");
  }
  return parsed as MoveContinuation[];
}
