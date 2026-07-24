export type Color = "w" | "b";
export type GameMode = "solo" | "multiplayer";
export type AiDifficulty = 1 | 2 | 3 | 4 | 5;
export type Promotion = "q" | "r" | "b" | "n";
export type DrawClaim = "threefold_repetition" | "fifty_move";
export type Termination =
  | "checkmate"
  | "stalemate"
  | "insufficient_material"
  | "threefold_repetition"
  | "fivefold_repetition"
  | "fifty_move"
  | "seventy_five_move"
  | "draw";

export interface StoredMove {
  ply: number;
  requestId: string;
  color: Color;
  from: string;
  to: string;
  promotion: Promotion | null;
  san: string;
  fenBefore: string;
  fenAfter: string;
  createdAt: string;
}

export interface PublicMove {
  ply: number;
  color: Color;
  from: string;
  to: string;
  promotion: Promotion | null;
  san: string;
  createdAt: string;
}

export interface GameSnapshot {
  id: string;
  mode: GameMode;
  aiDifficulty: AiDifficulty | null;
  status: "waiting" | "active" | "completed";
  version: number;
  fen: string;
  turn: Color;
  plyCount: number;
  players: {
    white: { name: string };
    black: { name: string } | null;
  };
  you: { color: Color; name: string };
  check: boolean;
  claimableDraws: DrawClaim[];
  outcome: { winner: Color | null; reason: Termination } | null;
  moves: PublicMove[];
  updatedAt: string;
}
