export type Color = "w" | "b";
export type Promotion = "q" | "r" | "b" | "n";
export type Termination =
  | "checkmate"
  | "stalemate"
  | "threefold_repetition"
  | "insufficient_material"
  | "fifty_move"
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
  outcome: { winner: Color | null; reason: Termination } | null;
  moves: PublicMove[];
  updatedAt: string;
}
