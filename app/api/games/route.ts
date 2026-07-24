import { chooseComputerMove } from "@/lib/computer-player";
import { applyCandidate, INITIAL_FEN } from "@/lib/game-rules";
import { findGameByCreateRequest, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import {
  hashSecret,
  isAiDifficulty,
  isGameMode,
  isSecret,
  isTurnPaceDays,
  isUuid,
  normalizeDisplayName,
  requestIsSameOrigin,
} from "@/lib/validation";
import { ensureSchema, getDatabase } from "@/db";
import type { Color } from "@/lib/game-types";
import type { AiDifficulty } from "@/lib/game-types";
import { recordEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";

function assignedSoloColor(requestId: string): Color {
  const finalHex = requestId.replace(/-/g, "").at(-1) ?? "0";
  return Number.parseInt(finalHex, 16) % 2 === 0 ? "w" : "b";
}

function humanName(game: Awaited<ReturnType<typeof findGameByCreateRequest>>): string | null {
  if (!game) return null;
  return game.human_color === "w" ? game.white_name : game.black_name;
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const body = await readJson(request);
  if (!body) return apiError(400, "invalid_request", "Invalid JSON request");

  const displayName = normalizeDisplayName(body.displayName);
  const playerToken = body.playerToken;
  const inviteToken = body.inviteToken;
  const requestId = body.requestId;
  const mode = body.mode === undefined ? "multiplayer" : body.mode;
  const difficulty = mode === "solo"
    ? body.difficulty === undefined ? 3 : body.difficulty
    : null;
  const turnPaceDays = mode === "multiplayer"
    ? body.turnPaceDays === undefined ? 3 : body.turnPaceDays
    : null;
  const turnPaceMatches = (value: number | null) =>
    value === turnPaceDays
    || (mode === "multiplayer" && body.turnPaceDays === undefined && value === null);
  if (!displayName || !isSecret(playerToken) || !isSecret(inviteToken) || !isUuid(requestId)) {
    return apiError(400, "invalid_request", "Name, secrets, or request id are invalid");
  }
  if (
    !isGameMode(mode)
    || (mode === "solo" && !isAiDifficulty(difficulty))
    || (mode === "multiplayer" && !isTurnPaceDays(turnPaceDays))
  ) {
    return apiError(400, "invalid_request", "Game mode, bot level, or turn pace is invalid");
  }
  if (playerToken === inviteToken) return apiError(400, "invalid_request", "Secrets must be different");

  await ensureSchema();
  const [playerHash, inviteHash] = await Promise.all([hashSecret(playerToken), hashSecret(inviteToken)]);
  const existing = await findGameByCreateRequest(requestId);
  if (existing) {
    if (
      humanName(existing) !== displayName ||
      playerColor(existing, playerHash) !== existing.human_color ||
      existing.invite_token_hash !== inviteHash ||
      existing.game_mode !== mode ||
      existing.ai_difficulty !== difficulty ||
      !turnPaceMatches(existing.turn_pace_days)
    ) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    const game = snapshot(existing, await readMoves(existing.id), existing.human_color);
    return json({
      game,
      ...(mode === "multiplayer"
        ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
        : {}),
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = mode === "solo" ? "active" : "waiting";
  const humanColor: Color = mode === "solo" ? assignedSoloColor(requestId) : "w";
  const computerColor: Color | null = mode === "solo"
    ? humanColor === "w" ? "b" : "w"
    : null;
  const botHash = mode === "solo"
    ? await hashSecret(`riot-bot:${id}:${crypto.randomUUID()}`)
    : null;
  const whiteName = humanColor === "w" ? displayName : "Riot Bot";
  const blackName = mode === "multiplayer"
    ? null
    : humanColor === "b" ? displayName : "Riot Bot";
  const whiteHash = humanColor === "w" ? playerHash : botHash;
  const blackHash = humanColor === "b"
    ? playerHash
    : mode === "solo" ? botHash : null;
  const joinedAt = mode === "solo" ? now : null;
  const openingCandidate = mode === "solo" && computerColor === "w" && difficulty
    ? chooseComputerMove(INITIAL_FEN, difficulty as AiDifficulty, computerColor)
    : null;
  if (mode === "solo" && computerColor === "w" && !openingCandidate) {
    return apiError(500, "computer_move_failed", "The computer could not open the game");
  }
  const opening = openingCandidate
    ? applyCandidate(INITIAL_FEN, [], openingCandidate)
    : null;
  const initialVersion = opening ? 1 : 0;
  const initialPly = opening ? 1 : 0;
  const currentFen = opening?.fenAfter ?? INITIAL_FEN;
  const turnColor = opening?.turn ?? "w";
  try {
    const db = getDatabase();
    const writes = [
      db.prepare(`INSERT INTO games (
        id, create_request_id, status, white_name, black_name, white_token_hash,
        black_token_hash, invite_token_hash, initial_fen, current_fen, turn_color, version, ply_count,
        created_at, joined_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          requestId,
          status,
          whiteName,
          blackName,
          whiteHash,
          blackHash,
          inviteHash,
          INITIAL_FEN,
          currentFen,
          turnColor,
          initialVersion,
          initialPly,
          now,
          joinedAt,
          now,
        ),
      db.prepare(`INSERT INTO game_settings (
        game_id, game_mode, ai_difficulty, human_color, turn_pace_days
      ) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, mode, difficulty, humanColor, turnPaceDays),
    ];
    if (opening && openingCandidate && computerColor) {
      writes.push(
        db.prepare(`INSERT INTO moves (
          game_id, ply, request_id, color, from_square, to_square, promotion,
          san, fen_before, fen_after, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            id,
            crypto.randomUUID(),
            computerColor,
            openingCandidate.from,
            openingCandidate.to,
            openingCandidate.promotion ?? null,
            opening.move.san,
            opening.fenBefore,
            opening.fenAfter,
            now,
          ),
      );
    }
    await db.batch(writes);
  } catch {
    const raced = await findGameByCreateRequest(requestId);
    if (
      !raced ||
      humanName(raced) !== displayName ||
      playerColor(raced, playerHash) !== raced.human_color ||
      raced.invite_token_hash !== inviteHash ||
      raced.game_mode !== mode ||
      raced.ai_difficulty !== difficulty ||
      !turnPaceMatches(raced.turn_pace_days)
    ) {
      return apiError(409, "idempotency_conflict", "Could not create this game");
    }
    return json({
      game: snapshot(raced, await readMoves(raced.id), raced.human_color),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
        : {}),
    });
  }

  const created = await findGameByCreateRequest(requestId);
  if (!created || playerColor(created, playerHash) !== created.human_color) {
    return apiError(500, "create_failed", "Game could not be loaded after creation");
  }
  if (opening && openingCandidate && computerColor) {
    await recordEvent({
      event: "bot.move_committed",
      outcome: "success",
      subjectId: created.id,
      metadata: {
        color: computerColor,
        difficulty: difficulty as number,
        opening: true,
      },
    });
  }
  return json(
    {
      game: snapshot(created, await readMoves(created.id), created.human_color),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
        : {}),
    },
    { status: 201 },
  );
}
