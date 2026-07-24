import { getDatabase } from "@/db";
import { chooseComputerMove } from "./computer-player";
import { applyCandidate } from "./game-rules";
import { findGameById, readMoves } from "./game-store";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

export async function playPendingComputerTurn(gameId: string): Promise<void> {
  const game = await findGameById(gameId);
  if (
    !game ||
    game.game_mode !== "solo" ||
    game.status !== "active" ||
    game.turn_color !== "b" ||
    game.ai_difficulty === null
  ) return;

  const storedMoves = await readMoves(gameId);
  const candidate = chooseComputerMove(game.current_fen, game.ai_difficulty);
  if (!candidate) return;
  const outcome = applyCandidate(game.initial_fen, storedMoves, candidate);
  const now = new Date().toISOString();
  const nextVersion = game.version + 1;
  const nextPly = game.ply_count + 1;
  const attemptNonce = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const status = outcome.completed ? "completed" : "active";
  const db = getDatabase();

  const results = await db.batch([
    db.prepare(`UPDATE games SET
      status = ?, current_fen = ?, turn_color = ?, version = ?, ply_count = ?,
      winner_color = ?, termination = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND version = ? AND status = 'active' AND turn_color = 'b'
        AND EXISTS (
          SELECT 1 FROM game_settings
          WHERE game_settings.game_id = games.id AND game_settings.game_mode = 'solo'
        )`)
      .bind(
        status,
        outcome.fenAfter,
        outcome.turn,
        nextVersion,
        nextPly,
        outcome.winner,
        outcome.termination,
        attemptNonce,
        now,
        outcome.completed ? now : null,
        gameId,
        game.version,
      ),
    db.prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, 'b', ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
      .bind(
        gameId,
        nextPly,
        requestId,
        candidate.from,
        candidate.to,
        candidate.promotion ?? null,
        outcome.move.san,
        outcome.fenBefore,
        outcome.fenAfter,
        now,
        gameId,
        nextVersion,
        attemptNonce,
      ),
  ]);

  if (
    (changes(results[0]) === 1 && changes(results[1]) === 1) ||
    (changes(results[0]) === 0 && changes(results[1]) === 0)
  ) return;
  throw new Error("Computer move was not stored atomically");
}
