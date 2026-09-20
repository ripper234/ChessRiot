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
  mode: GameMode;
  variantId: GameVariantId;
  difficulty: AiDifficulty;
  turnPaceDays: TurnPaceDays;
  opponentUsername?: string | null;
  worldCode?: string | null;
  pending: PendingGameCreate;
}

export function gameCreatePayload(input: GameCreateInput) {
  return {
    mode: input.mode,
    variantId: input.variantId,
    ...(input.mode === "solo" ? { difficulty: input.difficulty } : {}),
    ...(input.mode === "multiplayer" ? { turnPaceDays: input.turnPaceDays } : {}),
    ...(input.mode === "multiplayer" && input.opponentUsername
      ? { opponentUsername: input.opponentUsername }
      : {}),
    ...(input.worldCode ? { worldCode: input.worldCode } : {}),
    ...input.pending,
  };
}
