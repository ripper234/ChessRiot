import { Chess } from "chess.js";
import { ensureSchema, getDatabase } from "@/db";
import type {
  AiDifficulty,
  Color,
  GameMode,
  GameSnapshot,
  Promotion,
  StoredMove,
  Termination,
} from "./game-types";

export interface GameRow {
  id: string;
  create_request_id: string;
  status: "waiting" | "active" | "completed";
  white_name: string;
  black_name: string | null;
  white_token_hash: string;
  black_token_hash: string | null;
  invite_token_hash: string;
  initial_fen: string;
  current_fen: string;
  turn_color: Color;
  version: number;
  ply_count: number;
  winner_color: Color | null;
  termination: Termination | null;
  last_mutation_nonce: string | null;
  created_at: string;
  joined_at: string | null;
  updated_at: string;
  finished_at: string | null;
  game_mode: GameMode;
  ai_difficulty: AiDifficulty | null;
}

interface MoveRow {
  game_id: string;
  ply: number;
  request_id: string;
  color: Color;
  from_square: string;
  to_square: string;
  promotion: Promotion | null;
  san: string;
  fen_before: string;
  fen_after: string;
  created_at: string;
}

export async function findGameById(id: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        game_settings.ai_difficulty AS ai_difficulty
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        WHERE games.id = ?`)
      .bind(id)
      .first<GameRow>()) ?? null
  );
}

export async function findGameByCreateRequest(requestId: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        game_settings.ai_difficulty AS ai_difficulty
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        WHERE games.create_request_id = ?`)
      .bind(requestId)
      .first<GameRow>()) ?? null
  );
}

export async function findGameByInviteHash(inviteHash: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        game_settings.ai_difficulty AS ai_difficulty
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        WHERE games.invite_token_hash = ?`)
      .bind(inviteHash)
      .first<GameRow>()) ?? null
  );
}

export async function readMoves(gameId: string): Promise<StoredMove[]> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .bind(gameId)
    .all<MoveRow>();
  return (result.results ?? []).map((row: MoveRow) => ({
    ply: row.ply,
    requestId: row.request_id,
    color: row.color,
    from: row.from_square,
    to: row.to_square,
    promotion: row.promotion,
    san: row.san,
    fenBefore: row.fen_before,
    fenAfter: row.fen_after,
    createdAt: row.created_at,
  }));
}

export function playerColor(game: GameRow, tokenHash: string): Color | null {
  if (game.white_token_hash === tokenHash) return "w";
  if (game.black_token_hash === tokenHash) return "b";
  return null;
}

export function snapshot(game: GameRow, moves: StoredMove[], you: Color): GameSnapshot {
  const position = new Chess(game.current_fen);
  return {
    id: game.id,
    mode: game.game_mode,
    aiDifficulty: game.ai_difficulty,
    status: game.status,
    version: game.version,
    fen: game.current_fen,
    turn: game.turn_color,
    plyCount: game.ply_count,
    players: {
      white: { name: game.white_name },
      black: game.black_name ? { name: game.black_name } : null,
    },
    you: { color: you, name: you === "w" ? game.white_name : game.black_name ?? "Player 2" },
    check: position.isCheck(),
    outcome: game.termination
      ? { winner: game.winner_color, reason: game.termination }
      : null,
    moves: moves.map(({ ply, color, from, to, promotion, san, createdAt }) => ({
      ply,
      color,
      from,
      to,
      promotion,
      san,
      createdAt,
    })),
    updatedAt: game.updated_at,
  };
}
