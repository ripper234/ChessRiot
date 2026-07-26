import { getDatabase } from "@/db";
import { chooseComputerMove } from "./computer-player";
import { applyCandidate } from "./game-rules";
import {
  assertAuthoritativeState,
  computerColor,
  findGameById,
  gameMagicRules,
  readMoves,
} from "./game-store";
import { recordEvent } from "./observability";
import { serializeMoveContinuation } from "./move-continuation";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

const BOT_TURN_LEASE_MS = 10_000;

async function acquireBotTurnLease(
  gameId: string,
  gameVersion: number,
): Promise<string | null> {
  const now = new Date();
  const nonce = crypto.randomUUID();
  const row = await getDatabase()
    .prepare(
      `INSERT INTO bot_turn_leases (
        game_id, game_version, nonce, lease_until
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET
        game_version = excluded.game_version,
        nonce = excluded.nonce,
        lease_until = excluded.lease_until
      WHERE bot_turn_leases.game_version <> excluded.game_version
        OR bot_turn_leases.lease_until <= ?
      RETURNING nonce`,
    )
    .bind(
      gameId,
      gameVersion,
      nonce,
      new Date(now.getTime() + BOT_TURN_LEASE_MS).toISOString(),
      now.toISOString(),
    )
    .first<{ nonce: string }>();
  return row?.nonce === nonce ? nonce : null;
}

async function releaseBotTurnLease(
  gameId: string,
  nonce: string,
): Promise<void> {
  await getDatabase()
    .prepare("DELETE FROM bot_turn_leases WHERE game_id = ? AND nonce = ?")
    .bind(gameId, nonce)
    .run();
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
  )
    return;

  const expectedVersion = game.version;
  const leaseNonce = await acquireBotTurnLease(gameId, expectedVersion);
  if (!leaseNonce) return;
  const playWithLease = async (): Promise<void> => {
    const leasedGame = await findGameById(gameId);
    if (
      !leasedGame ||
      leasedGame.version !== expectedVersion ||
      leasedGame.game_mode !== "solo" ||
      leasedGame.status !== "active" ||
      leasedGame.turn_color !== botColor ||
      leasedGame.ai_difficulty === null
    )
      return;
    const difficulty = leasedGame.ai_difficulty;
    const storedMoves = await readMoves(gameId);
    const replayed = assertAuthoritativeState(leasedGame, storedMoves);
    const magicRules = gameMagicRules(leasedGame);
    const startedAt = performance.now();
    const candidate = chooseComputerMove(
      replayed.fen(),
      difficulty,
      botColor,
      Math.random,
      magicRules,
    );
    if (!candidate) {
      await recordEvent({
        event: "bot.move_failed",
        outcome: "failure",
        subjectId: gameId,
        errorCode: "no_legal_candidate",
        metadata: { color: botColor, difficulty },
      });
      throw new Error("Active computer turn has no legal move");
    }
    const outcome = applyCandidate(
      leasedGame.initial_fen,
      storedMoves,
      candidate,
      magicRules,
    );
    const now = new Date().toISOString();
    const nextVersion = leasedGame.version + 1;
    const nextPly = leasedGame.ply_count + 1;
    const attemptNonce = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const status = outcome.completed ? "completed" : "active";
    const db = getDatabase();

    const results = await db.batch([
      db
        .prepare(
          `UPDATE games SET
      status = ?, current_fen = ?, turn_color = ?, version = ?, ply_count = ?,
      winner_color = ?, termination = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND version = ? AND status = 'active' AND turn_color = ?
        AND EXISTS (
          SELECT 1 FROM game_settings
          WHERE game_settings.game_id = games.id AND game_settings.game_mode = 'solo'
        )`,
        )
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
          leasedGame.version,
          botColor,
        ),
      db
        .prepare(
          `INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, second_from_square, second_to_square, second_san,
      continuation_json, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`,
        )
        .bind(
          gameId,
          nextPly,
          requestId,
          botColor,
          candidate.from,
          candidate.to,
          candidate.promotion ?? null,
          outcome.move.san,
          candidate.second?.from ?? null,
          candidate.second?.to ?? null,
          outcome.secondMove?.san ?? null,
          serializeMoveContinuation(outcome.continuationMoves),
          outcome.fenBefore,
          outcome.fenAfter,
          now,
          gameId,
          nextVersion,
          attemptNonce,
        ),
    ]);

    const committed =
      (changes(results[0]) === 1 && changes(results[1]) === 1) ||
      (changes(results[0]) === 0 && changes(results[1]) === 0);
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
          difficulty,
          gameStatus: status,
          magic: Boolean(magicRules),
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
  };

  try {
    await playWithLease();
  } finally {
    try {
      await releaseBotTurnLease(gameId, leaseNonce);
    } catch {
      // The short lease expires safely if cleanup is temporarily unavailable.
    }
  }
}
