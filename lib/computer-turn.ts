import { getDatabase } from "@/db";
import { chooseComputerMove } from "./computer-player";
import { applyCandidate } from "./game-rules";
import {
  assertAuthoritativeState,
  computerColor,
  findGameById,
  readMoves,
} from "./game-store";
import { recordEvent } from "./observability";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

export async function playPendingComputerTurn(gameId: string): Promise<void> {
  const game = await findGameById(gameId);
  const botColor = game ? computerColor(game) : null;
  if (
    !game ||
    game.game_mode !== "solo" ||
    game.status !== "active" ||
    !botColor ||
    game.turn_color !== botColor ||
    game.ai_difficulty === null
  ) return;

  const storedMoves = await readMoves(gameId);
  const replayed = assertAuthoritativeState(game, storedMoves);
  const startedAt = performance.now();
  const candidate = chooseComputerMove(replayed.fen(), game.ai_difficulty, botColor);
  if (!candidate) {
    await recordEvent({
      event: "bot.move_failed",
      outcome: "failure",
      subjectId: gameId,
      errorCode: "no_legal_candidate",
      metadata: { color: botColor, difficulty: game.ai_difficulty },
    });
    throw new Error("Active computer turn has no legal move");
  }
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
      WHERE id = ? AND version = ? AND status = 'active' AND turn_color = ?
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
        botColor,
      ),
    db.prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
      .bind(
        gameId,
        nextPly,
        requestId,
        botColor,
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

  const committed = (
    (changes(results[0]) === 1 && changes(results[1]) === 1) ||
    (changes(results[0]) === 0 && changes(results[1]) === 0)
  );
  if (committed) {
    const wonCommit = changes(results[0]) === 1;
    await recordEvent({
      event: wonCommit ? "bot.move_committed" : "bot.move_raced",
      outcome: "success",
      requestId,
      subjectId: gameId,
      latencyMs: performance.now() - startedAt,
      metadata: {
        color: botColor,
        difficulty: game.ai_difficulty,
        ...(wonCommit ? { from: candidate.from, to: candidate.to } : {}),
        gameStatus: status,
      },
    });
    if (wonCommit && outcome.completed) {
      await recordEvent({
        event: "game.completed",
        outcome: "success",
        requestId,
        subjectId: gameId,
        metadata: {
          mode: "solo",
          termination: outcome.termination,
          winner: outcome.winner,
        },
      });
    }
    return;
  }
  throw new Error("Computer move was not stored atomically");
}
