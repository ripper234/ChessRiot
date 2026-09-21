import { premoveColumn, readPremove, validPremove, type PremoveState } from "@/lib/premoves";
import type { Square } from "chess.js";
import { getDatabase } from "@/db";
import {
  chooseComputerMove,
  seededComputerRandom,
} from "@/lib/computer-player";
import {
  applyCandidate,
  IllegalMoveError,
  isPromotion,
  isSquare,
  type CandidateMove,
  type MoveOutcome,
} from "@/lib/game-rules";
import {
  assertAuthoritativeState,
  computerColor,
  expireMultiplayerTurn,
  findGameById,
  gameMagicRules,
  multiplayerTurnDeadline,
  readMoves,
  snapshot,
  type GameRow,
} from "@/lib/game-store";
import { authorizeGameRequest } from "@/lib/game-auth";
import { enforceAccountRateLimit } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import type { Promotion, StoredMove } from "@/lib/game-types";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";
import { recordEvent } from "@/lib/observability";
import { markMagicWorldPlayed } from "@/lib/magic-worlds";
import { hasMagicRule } from "@/lib/magic-rules";
import { serializeMoveContinuation } from "@/lib/move-continuation";
import { queueTurnNotifications } from "@/lib/push-notifications";
import { canPlayPendingOpening } from "@/lib/pending-opening";

export const dynamic = "force-dynamic";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

async function reconcileMagicWorldPlay(gameId: string): Promise<void> {
  try {
    await markMagicWorldPlayed(gameId);
  } catch (error) {
    await recordEvent({
      event: "magic.world_play_reconcile",
      outcome: "failure",
      subjectId: gameId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

function isSecondMove(value: unknown): value is { from: string; to: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { from?: unknown; to?: unknown };
  return isSquare(candidate.from) && isSquare(candidate.to);
}

interface RequestedContinuation {
  from: string;
  to: string;
  promotion?: Promotion;
}

function isContinuation(value: unknown): value is RequestedContinuation[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 5
    && value.every((leg) => {
      if (!leg || typeof leg !== "object" || Array.isArray(leg)) return false;
      const candidate = leg as {
        from?: unknown;
        to?: unknown;
        promotion?: unknown;
      };
      return isSquare(candidate.from)
        && isSquare(candidate.to)
        && (candidate.promotion === undefined || isPromotion(candidate.promotion))
        && Object.keys(candidate).every((key) =>
          key === "from" || key === "to" || key === "promotion");
    });
}

function sameMoveRequest(
  move: Awaited<ReturnType<typeof readMoves>>[number] | undefined,
  color: "w" | "b",
  from: string,
  to: string,
  promotion: Promotion | undefined,
  continuation: RequestedContinuation[],
): boolean {
  const storedContinuation = move?.continuation ?? [];
  return Boolean(
    move
    && move.color === color
    && move.from === from
    && move.to === to
    && (move.promotion ?? undefined) === promotion
    && storedContinuation.length === continuation.length
    && storedContinuation.every((leg, index) =>
      leg.from === continuation[index]?.from
      && leg.to === continuation[index]?.to
      && (leg.promotion ?? undefined) === continuation[index]?.promotion)
  );
}

function notificationTestResponseHeaders(game: GameRow): Record<string, string> {
  return game.notification_test_device_id && game.status === "active"
    && game.turn_color !== game.human_color && game.ply_count < 8
    && (game.notification_test_expires_at ?? 0) > Date.now()
    ? { "x-chessriot-notification-test-version": String(game.version) } : {};
}

function storedMove(
  ply: number,
  requestId: string,
  candidate: CandidateMove,
  outcome: MoveOutcome,
  createdAt: string,
): StoredMove {
  return {
    ply,
    requestId,
    color: outcome.move.color,
    from: outcome.move.from,
    to: outcome.move.to,
    promotion: candidate.promotion ?? null,
    san: outcome.move.san,
    continuation: outcome.continuationMoves.map((move) => ({
      from: move.from,
      to: move.to,
      promotion: move.promotion as Promotion | undefined,
      san: move.san,
    })),
    second: outcome.secondMove
      ? {
        from: outcome.secondMove.from,
        to: outcome.secondMove.to,
        san: outcome.secondMove.san,
      }
      : null,
    fenBefore: outcome.fenBefore,
    fenAfter: outcome.fenAfter,
    createdAt,
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return commitMove(request, context, 2);
}

async function commitMove(
  request: Request,
  context: { params: Promise<{ id: string }> },
  remainingRetries: number,
): Promise<Response> {
  const retryRequest = request.clone() as Request;
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const { id } = await context.params;
  const authorization = await authorizeGameRequest(request, id);
  if (!authorization.ok) {
    return apiError(
      authorization.status,
      authorization.code,
      authorization.message,
    );
  }
  const rate = await enforceAccountRateLimit(
    authorization.account.id,
    "game_move",
    120,
    60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many move attempts. Try again shortly." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  const from = body?.from;
  const to = body?.to;
  const promotion = body?.promotion;
  const second = body?.second;
  const continuation = body?.continuation;
  const expectedVersion = body?.expectedVersion;
  const requestId = body?.requestId;
  if (
    !isSquare(from) ||
    !isSquare(to) ||
    (promotion !== undefined && !isPromotion(promotion)) ||
    (second !== undefined && !isSecondMove(second)) ||
    (continuation !== undefined && !isContinuation(continuation)) ||
    (second !== undefined && continuation !== undefined) ||
    !Number.isInteger(expectedVersion) ||
    (expectedVersion as number) < 0 ||
    !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "Move request is invalid");
  }
  const secondMove = second as { from: string; to: string } | undefined;
  const continuationMoves = continuation !== undefined
    ? continuation as RequestedContinuation[]
    : secondMove ? [secondMove] : [];

  const { color } = authorization;
  let game: GameRow | null = authorization.game;
  game = await expireMultiplayerTurn(game);

  let storedMoves = await readMoves(id);
  const repeated = storedMoves.find((move) => move.requestId === requestId);
  if (repeated) {
    if (!sameMoveRequest(
      repeated,
      color,
      from,
      to,
      promotion as Promotion | undefined,
      continuationMoves,
    )) {
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    if (game.world_code) await reconcileMagicWorldPlay(id);
    return json({ game: snapshot(game, storedMoves, color) }, { headers: notificationTestResponseHeaders(game) });
  }
  const pendingOpening = game.joined_at === null && canPlayPendingOpening({
    mode: game.game_mode, status: game.status, turnPaceDays: game.turn_pace_days,
    turn: game.turn_color, plyCount: game.ply_count,
  }, color);
  if (game.status !== "active" && !pendingOpening) return apiError(409, "game_not_active", "The game is not active");
  if (game.version !== expectedVersion) {
    return json(
      { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
      { status: 409 },
    );
  }
  if (game.turn_color !== color) return apiError(409, "wrong_turn", "It is not your turn");

  let replayed;
  try {
    replayed = assertAuthoritativeState(game, storedMoves);
  } catch {
    return apiError(500, "history_mismatch", "Stored game history does not match the board");
  }
  const magicRules = gameMagicRules(game);
  const piece = replayed.get(from as Square);
  if (promotion !== undefined && hasMagicRule(magicRules, "no_promotion")) {
    return apiError(422, "promotion_disabled", "Pawns cannot promote in this game");
  }
  if (
    piece?.type === "p"
    && (to.endsWith("8") || to.endsWith("1"))
    && promotion === undefined
    && !hasMagicRule(magicRules, "no_promotion")
  ) {
    return apiError(422, "promotion_required", "Choose a promotion piece");
  }

  const humanCandidate: CandidateMove = {
    from,
    to,
    ...(promotion ? { promotion: promotion as Promotion } : {}),
    ...(continuationMoves.length > 0
      ? { continuation: continuationMoves }
      : {}),
  };
  let humanOutcome: MoveOutcome;
  const wasInCheck = replayed.isCheck();
  try {
    humanOutcome = applyCandidate(
      game.initial_fen,
      storedMoves,
      humanCandidate,
      magicRules,
    );
  } catch (error) {
    if (error instanceof IllegalMoveError) {
      return wasInCheck
        ? apiError(
          422,
          "must_answer_check",
          "You are in check. Move the king, capture the attacker, or block the attack.",
        )
        : apiError(422, "illegal_move", "That move is not legal");
    }
    throw error;
  }

  if (pendingOpening && humanOutcome.completed) {
    return apiError(409, "opening_requires_acceptance", "Wait for your friend to accept before playing a move that ends the game.");
  }
  if (game.notification_test_device_id && (
    (game.notification_test_expires_at ?? 0) <= Date.now() || game.ply_count >= 8
  )) return apiError(409, "notification_test_finished", "This four-turn test has finished. Start a new test to repeat it.");
  const now = new Date().toISOString();
  const deadlineAt = multiplayerTurnDeadline(game);
  const attemptNonce = crypto.randomUUID();
  const humanPly = game.ply_count + 1;
  const humanMove = storedMove(
    humanPly,
    requestId,
    humanCandidate,
    humanOutcome,
    now,
  );
  const botColor = computerColor(game);
  let botMove: StoredMove | null = null;
  let botOutcome: MoveOutcome | null = null;
  let botLatencyMs: number | null = null;
  if (
    !humanOutcome.completed
    && game.game_mode === "solo"
    && !game.notification_test_device_id
    && game.ai_difficulty !== null
    && botColor
    && humanOutcome.turn === botColor
  ) {
    const botStartedAt = performance.now();
    const candidate = chooseComputerMove(
      humanOutcome.fenAfter,
      game.ai_difficulty,
      botColor,
      seededComputerRandom(requestId),
      magicRules,
    );
    if (!candidate) {
      return apiError(500, "computer_move_failed", "The computer could not answer this move");
    }
    botOutcome = applyCandidate(
      game.initial_fen,
      [...storedMoves, humanMove],
      candidate,
      magicRules,
    );
    botMove = storedMove(
      humanPly + 1,
      crypto.randomUUID(),
      candidate,
      botOutcome,
      now,
    );
    botLatencyMs = performance.now() - botStartedAt;
  }

  const queuedColor = color === "w" ? "b" : "w";
  const queuedColumn = premoveColumn(queuedColor);
  const queued = readPremove(game, queuedColor);
  let consumedPremove: PremoveState | null = null;
  let premoveOwner: string | null = null;
  if (!pendingOpening && game.game_mode === "multiplayer" && queued.status === "queued") {
    consumedPremove = { ...queued, revision: queued.revision + 1, status: "invalid", move: null };
    if (!humanOutcome.completed && queued.version === game.version && validPremove(queued.move)
      && queued.accountId) {
      const membership = await getDatabase().prepare(`SELECT membership.account_id
        FROM game_memberships AS membership JOIN accounts ON accounts.id = membership.account_id
        WHERE membership.game_id = ? AND membership.color = ? AND membership.account_id = ?`)
        .bind(id, queuedColor, queued.accountId).first<{ account_id: string }>();
      if (membership) {
        try {
          botOutcome = applyCandidate(game.initial_fen, [...storedMoves, humanMove], queued.move, magicRules);
          botMove = storedMove(humanPly + 1, crypto.randomUUID(), queued.move, botOutcome, now);
          consumedPremove.status = "played";
          premoveOwner = membership.account_id;
        } catch (error) {
          if (!(error instanceof IllegalMoveError)) throw error;
        }
      }
    }
  }
  const finalOutcome = botOutcome ?? humanOutcome;
  const advancedPlies = botMove ? 2 : 1;
  const nextVersion = game.version + advancedPlies;
  const nextPly = game.ply_count + advancedPlies;
  const status = pendingOpening ? "waiting" : finalOutcome.completed ? "completed" : "active";
  const db = getDatabase();
  const update = db
    .prepare(`UPDATE games SET
      status = ?, current_fen = ?, turn_color = ?, version = ?, ply_count = ?,
      winner_color = ?, termination = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?,
      ${queuedColumn} = ?
      WHERE id = ? AND version = ? AND status = ? AND turn_color = ?
        AND ${queuedColumn} IS ?
        AND (? IS NULL OR EXISTS (SELECT 1 FROM game_memberships AS queued_member
          JOIN accounts ON accounts.id = queued_member.account_id
          WHERE queued_member.game_id = games.id AND queued_member.color = ? AND queued_member.account_id = ?))
        AND (? = 0 OR (joined_at IS NULL AND ply_count = 0))
        AND (? IS NULL OR julianday('now') < julianday(?))
        AND EXISTS (
          SELECT 1 FROM game_memberships
          WHERE game_memberships.game_id = games.id
            AND game_memberships.account_id = ?
            AND game_memberships.color = ?
        )`)
    .bind(
      status,
      finalOutcome.fenAfter,
      finalOutcome.turn,
      nextVersion,
      nextPly,
      finalOutcome.winner,
      finalOutcome.termination,
      attemptNonce,
      now,
      finalOutcome.completed ? now : null,
      consumedPremove ? JSON.stringify(consumedPremove) : game[queuedColumn] ?? null,
      id,
      expectedVersion,
      game.status,
      color,
      game[queuedColumn] ?? null,
      premoveOwner, queuedColor, premoveOwner,
      pendingOpening ? 1 : 0,
      deadlineAt,
      deadlineAt,
      authorization.account.id,
      color,
    );
  const humanInsert = db
    .prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, second_from_square, second_to_square, second_san,
      continuation_json, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
    .bind(
      id,
      humanPly,
      requestId,
      color,
      from,
      to,
      promotion ?? null,
      humanOutcome.move.san,
      continuationMoves[0]?.from ?? null,
      continuationMoves[0]?.to ?? null,
      humanOutcome.secondMove?.san ?? null,
      serializeMoveContinuation(humanOutcome.continuationMoves),
      humanOutcome.fenBefore,
      humanOutcome.fenAfter,
      now,
      id,
      nextVersion,
      attemptNonce,
    );
  const writes = [update, humanInsert];
  if (botMove) {
    writes.push(
      db
        .prepare(`INSERT INTO moves (
          game_id, ply, request_id, color, from_square, to_square, promotion,
          san, second_from_square, second_to_square, second_san,
          continuation_json, fen_before, fen_after, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
        .bind(
          id,
          botMove.ply,
          botMove.requestId,
          botMove.color,
          botMove.from,
          botMove.to,
          botMove.promotion,
          botMove.san,
          botMove.second?.from ?? null,
          botMove.second?.to ?? null,
          botMove.second?.san ?? null,
          serializeMoveContinuation(botOutcome?.continuationMoves ?? []),
          botMove.fenBefore,
          botMove.fenAfter,
          now,
          id,
          nextVersion,
          attemptNonce,
        ),
    );
  }
  const requiredWriteCount = writes.length;
  const shouldNotifyOpponent = game.game_mode === "multiplayer"
    && status === "active";
  if (shouldNotifyOpponent) {
    writes.push(...queueTurnNotifications(db, {
      gameId: id,
      gameVersion: nextVersion,
      targetColor: finalOutcome.turn,
      mutationNonce: attemptNonce,
      createdAt: now,
    }));
  }

  let results: D1Result<unknown>[];
  try {
    results = await db.batch(writes);
  } catch {
    game = await findGameById(id);
    if (game) game = await expireMultiplayerTurn(game);
    storedMoves = await readMoves(id);
    const wonRace = storedMoves.find((move) => move.requestId === requestId);
    if (game && wonRace) {
      if (sameMoveRequest(
        wonRace,
        color,
        from,
        to,
        promotion as Promotion | undefined,
        continuationMoves,
      )) {
        if (game.world_code) await reconcileMagicWorldPlay(id);
        return json({ game: snapshot(game, storedMoves, color) }, { headers: notificationTestResponseHeaders(game) });
      }
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  if (!results.slice(0, requiredWriteCount).every((result) => changes(result) === 1)) {
    const previousQueue = game[queuedColumn] ?? null;
    game = await findGameById(id);
    if (game && game.version === expectedVersion && remainingRetries > 0
      && (game[queuedColumn] ?? null) !== previousQueue) {
      return commitMove(retryRequest, context, remainingRetries - 1);
    }
    if (game) game = await expireMultiplayerTurn(game);
    storedMoves = await readMoves(id);
    const wonRace = storedMoves.find((move) => move.requestId === requestId);
    if (game && wonRace) {
      if (sameMoveRequest(
        wonRace,
        color,
        from,
        to,
        promotion as Promotion | undefined,
        continuationMoves,
      )) {
        if (game.world_code) await reconcileMagicWorldPlay(id);
        return json({ game: snapshot(game, storedMoves, color) }, { headers: notificationTestResponseHeaders(game) });
      }
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  const committedGame: GameRow = {
    ...game,
    [queuedColumn]: consumedPremove ? JSON.stringify(consumedPremove) : game[queuedColumn],
    status,
    current_fen: finalOutcome.fenAfter,
    turn_color: finalOutcome.turn,
    version: nextVersion,
    ply_count: nextPly,
    winner_color: finalOutcome.winner,
    termination: finalOutcome.termination,
    last_mutation_nonce: attemptNonce,
    updated_at: now,
    finished_at: finalOutcome.completed ? now : null,
  };
  const committedMoves = [
    ...storedMoves,
    humanMove,
    ...(botMove ? [botMove] : []),
  ];
  if (committedGame.world_code) await reconcileMagicWorldPlay(id);
  if (committedGame.status === "completed") {
    await recordEvent({
      event: "game.completed",
      outcome: "success",
      requestId,
      subjectId: id,
      metadata: {
        mode: committedGame.game_mode,
        termination: committedGame.termination,
        winner: committedGame.winner_color,
      },
    });
  }
  const responseHeaders = notificationTestResponseHeaders(committedGame);
  if (shouldNotifyOpponent) {
    responseHeaders["x-chessriot-turn-committed"] = "1";
  }
  if (botMove && botColor) {
    responseHeaders["x-chessriot-bot-committed"] = "1";
    responseHeaders["x-chessriot-bot-color"] = botColor;
    responseHeaders["x-chessriot-bot-difficulty"] = String(game.ai_difficulty);
    responseHeaders["x-chessriot-bot-latency-ms"] = String(Math.max(0, Math.round(botLatencyMs ?? 0)));
    responseHeaders["x-chessriot-bot-magic"] = magicRules ? "1" : "0";
  }
  return json(
    { game: snapshot(committedGame, committedMoves, color) },
    Object.keys(responseHeaders).length > 0 ? { headers: responseHeaders } : undefined,
  );
}
