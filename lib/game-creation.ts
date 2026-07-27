import type {
  AiDifficulty,
  GameMode,
  TurnPaceDays,
} from "./game-types";

export interface PendingGameCreate {
  playerToken: string;
  inviteToken: string;
  requestId: string;
}

interface GameCreateInput {
  displayName: string;
  guestToken: string;
  mode: GameMode;
  difficulty: AiDifficulty;
  turnPaceDays: TurnPaceDays;
  magicPrompt?: string;
  pending: PendingGameCreate;
}

export function gameCreatePayload(input: GameCreateInput) {
  return {
    displayName: input.displayName,
    guestToken: input.guestToken,
    mode: input.mode,
    ...(input.mode === "solo" ? { difficulty: input.difficulty } : {}),
    ...(input.mode === "multiplayer" ? { turnPaceDays: input.turnPaceDays } : {}),
    ...(input.magicPrompt ? { magicPrompt: input.magicPrompt } : {}),
    ...input.pending,
  };
}
