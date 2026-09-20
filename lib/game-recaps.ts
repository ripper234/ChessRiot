import { ensureSchema, getDatabase } from "@/db";
import { findGameById, readMoves, type GameRow } from "./game-store";
import type {
  AiDifficulty,
  Color,
  GameMode,
  PublicMove,
  Termination,
  TurnPaceDays,
} from "./game-types";
import type { GameVariantId } from "./game-variants";
import { displayMagicWorldCode } from "./magic-world-code";

const SHARE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicGameRecap {
  shareId: string;
  mode: GameMode;
  variantId: GameVariantId;
  aiDifficulty: AiDifficulty | null;
  turnPaceDays: TurnPaceDays | null;
  magic: boolean;
  world: { code: string; displayCode: string } | null;
  initialFen: string;
  players: {
    white: string;
    black: string;
  };
  outcome: {
    winner: Color | null;
    reason: Termination;
  };
  moves: PublicMove[];
  finishedAt: string;
}

export function validGameRecapShareId(value: string): boolean {
  return SHARE_ID_PATTERN.test(value);
}

export async function getOrCreateGameRecapShare(gameId: string): Promise<{
  id: string;
  created: boolean;
}> {
  await ensureSchema();
  const database = getDatabase();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const result = await database.prepare(`INSERT OR IGNORE INTO game_recap_shares (
      id, game_id, created_at
    ) VALUES (?, ?, ?)`)
    .bind(id, gameId, createdAt)
    .run();
  const row = await database.prepare(
    "SELECT id FROM game_recap_shares WHERE game_id = ?",
  ).bind(gameId).first<{ id: string }>();
  if (!row || !validGameRecapShareId(row.id)) throw new Error("recap_share_unavailable");
  return { id: row.id, created: (result.meta.changes ?? 0) === 1 };
}

export async function revokeGameRecapShare(gameId: string): Promise<boolean> {
  await ensureSchema();
  const result = await getDatabase().prepare(
    "DELETE FROM game_recap_shares WHERE game_id = ?",
  ).bind(gameId).run();
  return (result.meta.changes ?? 0) === 1;
}

function publicMoves(moves: Awaited<ReturnType<typeof readMoves>>): PublicMove[] {
  return moves.map((move) => ({
    ply: move.ply,
    color: move.color,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: move.san,
    second: move.second,
    continuation: move.continuation,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    createdAt: move.createdAt,
  }));
}

function recapFromGame(
  shareId: string,
  game: GameRow,
  moves: Awaited<ReturnType<typeof readMoves>>,
): PublicGameRecap | null {
  if (
    game.status !== "completed"
    || !game.termination
    || !game.black_name
    || !game.finished_at
  ) return null;
  return {
    shareId,
    mode: game.game_mode,
    variantId: game.variant_id,
    aiDifficulty: game.ai_difficulty,
    turnPaceDays: game.turn_pace_days,
    magic: Boolean(game.magic_rules_json),
    world: game.world_code ? {
      code: game.world_code,
      displayCode: displayMagicWorldCode(game.world_code),
    } : null,
    initialFen: game.initial_fen,
    players: { white: game.white_name, black: game.black_name },
    outcome: { winner: game.winner_color, reason: game.termination },
    moves: publicMoves(moves),
    finishedAt: game.finished_at,
  };
}

export async function findPublicGameRecap(
  shareId: string,
): Promise<PublicGameRecap | null> {
  if (!validGameRecapShareId(shareId)) return null;
  await ensureSchema();
  const share = await getDatabase().prepare(
    "SELECT game_id FROM game_recap_shares WHERE id = ?",
  ).bind(shareId).first<{ game_id: string }>();
  if (!share) return null;
  const game = await findGameById(share.game_id);
  if (!game) return null;
  return recapFromGame(shareId, game, await readMoves(game.id));
}
