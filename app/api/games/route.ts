import { INITIAL_FEN } from "@/lib/game-rules";
import { findGameByCreateRequest, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import {
  hashSecret,
  isAiDifficulty,
  isGameMode,
  isSecret,
  isUuid,
  normalizeDisplayName,
  requestIsSameOrigin,
} from "@/lib/validation";
import { ensureSchema, getDatabase } from "@/db";

export const dynamic = "force-dynamic";

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
  if (!displayName || !isSecret(playerToken) || !isSecret(inviteToken) || !isUuid(requestId)) {
    return apiError(400, "invalid_request", "Name, secrets, or request id are invalid");
  }
  if (!isGameMode(mode) || (mode === "solo" && !isAiDifficulty(difficulty))) {
    return apiError(400, "invalid_request", "Game mode or computer difficulty is invalid");
  }
  if (playerToken === inviteToken) return apiError(400, "invalid_request", "Secrets must be different");

  await ensureSchema();
  const [playerHash, inviteHash] = await Promise.all([hashSecret(playerToken), hashSecret(inviteToken)]);
  const existing = await findGameByCreateRequest(requestId);
  if (existing) {
    if (
      existing.white_name !== displayName ||
      existing.white_token_hash !== playerHash ||
      existing.invite_token_hash !== inviteHash ||
      existing.game_mode !== mode ||
      existing.ai_difficulty !== difficulty
    ) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    const game = snapshot(existing, await readMoves(existing.id), "w");
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
  const blackName = mode === "solo" ? "Riot Bot" : null;
  const joinedAt = mode === "solo" ? now : null;
  try {
    const db = getDatabase();
    await db.batch([
      db.prepare(`INSERT INTO games (
        id, create_request_id, status, white_name, black_name, white_token_hash,
        invite_token_hash, initial_fen, current_fen, turn_color, version, ply_count,
        created_at, joined_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'w', 0, 0, ?, ?, ?)`)
        .bind(
          id,
          requestId,
          status,
          displayName,
          blackName,
          playerHash,
          inviteHash,
          INITIAL_FEN,
          INITIAL_FEN,
          now,
          joinedAt,
          now,
        ),
      db.prepare(`INSERT INTO game_settings (game_id, game_mode, ai_difficulty)
        VALUES (?, ?, ?)`)
        .bind(id, mode, difficulty),
    ]);
  } catch {
    const raced = await findGameByCreateRequest(requestId);
    if (
      !raced ||
      raced.white_name !== displayName ||
      raced.white_token_hash !== playerHash ||
      raced.invite_token_hash !== inviteHash ||
      raced.game_mode !== mode ||
      raced.ai_difficulty !== difficulty
    ) {
      return apiError(409, "idempotency_conflict", "Could not create this game");
    }
    return json({
      game: snapshot(raced, await readMoves(raced.id), "w"),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
        : {}),
    });
  }

  const created = await findGameByCreateRequest(requestId);
  if (!created || playerColor(created, playerHash) !== "w") {
    return apiError(500, "create_failed", "Game could not be loaded after creation");
  }
  return json(
    {
      game: snapshot(created, [], "w"),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
        : {}),
    },
    { status: 201 },
  );
}
