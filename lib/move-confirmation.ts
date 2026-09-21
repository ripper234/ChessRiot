import type { PieceSymbol, Square } from "chess.js";
import type { GameSnapshot, Promotion } from "./game-types";
import { canPlayPendingOpening } from "./pending-opening";

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
const HEBREW_PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "חייל",
  n: "פרש",
  b: "רץ",
  r: "צריח",
  q: "מלכה",
  k: "מלך",
};
const HEBREW_PROMOTION_NAMES: Record<Promotion, string> = {
  q: "מלכה",
  r: "צריח",
  b: "רץ",
  n: "פרש",
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

export function describeMoveIntent(
  intent: MoveIntent,
  locale: "en" | "he" = "en",
): string {
  return describeMoveIntentParts(intent, locale).map((part) => part.text).join("");
}

export interface MoveIntentDescriptionPart {
  text: string;
  dir?: "ltr";
}

export function describeMoveIntentParts(
  intent: MoveIntent,
  locale: "en" | "he" = "en",
): MoveIntentDescriptionPart[] {
  const piece = intent.piece
    ? locale === "he" ? HEBREW_PIECE_NAMES[intent.piece] : PIECE_NAMES[intent.piece]
    : locale === "he" ? "כלי" : "piece";
  const continuation: Array<{
    from: Square;
    to: Square;
    promotion?: Promotion;
  }> = intent.continuation
    ?? (intent.second ? [intent.second] : []);
  const route = [intent.from, intent.to, ...continuation.map((leg) => leg.to)]
    .join(" → ");
  const continuationPromotion = continuation.find((leg) => leg.promotion);
  if (locale === "he") {
    const parts: MoveIntentDescriptionPart[] = [
      { text: `להזיז ${piece}: ` },
      { text: route, dir: "ltr" },
    ];
    if (intent.promotion) {
      parts.push({ text: ` ולהכתיר ל${HEBREW_PROMOTION_NAMES[intent.promotion]}` });
    } else if (continuationPromotion?.promotion) {
      parts.push(
        { text: " ולהכתיר ב־" },
        { text: continuationPromotion.to, dir: "ltr" },
        { text: ` ל${HEBREW_PROMOTION_NAMES[continuationPromotion.promotion]}` },
      );
    }
    parts.push({ text: "?" });
    return parts;
  }
  const parts: MoveIntentDescriptionPart[] = [
    { text: `Move ${piece} ` },
    { text: route, dir: "ltr" },
  ];
  if (intent.promotion) {
    parts.push({ text: ` and promote to ${PROMOTION_NAMES[intent.promotion]}` });
  } else if (continuationPromotion?.promotion) {
    parts.push(
      { text: " and promote on " },
      { text: continuationPromotion.to, dir: "ltr" },
      { text: ` to ${PROMOTION_NAMES[continuationPromotion.promotion]}` },
    );
  }
  parts.push({ text: "?" });
  return parts;
}

export function moveIntentStillValid(
  intent: MoveIntent,
  game: (Pick<GameSnapshot, "version" | "status" | "turn" | "you">
    & Partial<Pick<GameSnapshot, "mode" | "turnPaceDays" | "plyCount">>) | null,
): boolean {
  return Boolean(
    game
    && game.version === intent.expectedVersion
    && (game.status === "active" || canPlayPendingOpening(game, game.you.color))
    && game.turn === game.you.color,
  );
}
