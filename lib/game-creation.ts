import type {
  AiDifficulty,
  GameMode,
  TurnPaceDays,
} from "./game-types";
import type { GameVariantId } from "./game-variants";

export interface PendingGameCreate {
  playerToken: string;
  inviteToken: string;
  requestId: string;
}

interface GameCreateInput {
  displayName: string;
  guestToken: string;
  mode: GameMode;
  variantId: GameVariantId;
  difficulty: AiDifficulty;
  turnPaceDays: TurnPaceDays;
  pending: PendingGameCreate;
}

export function gameCreatePayload(input: GameCreateInput) {
  return {
    displayName: input.displayName,
    guestToken: input.guestToken,
    mode: input.mode,
    variantId: input.variantId,
    ...(input.mode === "solo" ? { difficulty: input.difficulty } : {}),
    ...(input.mode === "multiplayer" ? { turnPaceDays: input.turnPaceDays } : {}),
    ...input.pending,
  };
}
