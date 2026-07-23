import { INITIAL_FEN } from "@/lib/game-rules";
import { findGameByCreateRequest, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import { hashSecret, isSecret, isUuid, normalizeDisplayName, requestIsSameOrigin } from "@/lib/validation";
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
  if (!displayName || !isSecret(playerToken) || !isSecret(inviteToken) || !isUuid(requestId)) {
    return apiError(400, "invalid_request", "Name, secrets, or request id are invalid");
  }
  if (playerToken === inviteToken) return apiError(400, "invalid_request", "Secrets must be different");

  await ensureSchema();
  const [playerHash, inviteHash] = await Promise.all([hashSecret(playerToken), hashSecret(inviteToken)]);
  const existing = await findGameByCreateRequest(requestId);
  if (existing) {
    if (
      existing.white_name !== displayName ||
      existing.white_token_hash !== playerHash ||
      existing.invite_token_hash !== inviteHash
    ) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    const game = snapshot(existing, await readMoves(existing.id), "w");
    return json({ game, inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await getDatabase()
      .prepare(`INSERT INTO games (
        id, create_request_id, status, white_name, white_token_hash, invite_token_hash,
        initial_fen, current_fen, turn_color, version, ply_count, created_at, updated_at
      ) VALUES (?, ?, 'waiting', ?, ?, ?, ?, ?, 'w', 0, 0, ?, ?)`)
      .bind(id, requestId, displayName, playerHash, inviteHash, INITIAL_FEN, INITIAL_FEN, now, now)
      .run();
  } catch {
    const raced = await findGameByCreateRequest(requestId);
    if (
      !raced ||
      raced.white_name !== displayName ||
      raced.white_token_hash !== playerHash ||
      raced.invite_token_hash !== inviteHash
    ) {
      return apiError(409, "idempotency_conflict", "Could not create this game");
    }
    return json({
      game: snapshot(raced, await readMoves(raced.id), "w"),
      inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}`,
    });
  }

  const created = await findGameByCreateRequest(requestId);
  if (!created || playerColor(created, playerHash) !== "w") {
    return apiError(500, "create_failed", "Game could not be loaded after creation");
  }
  return json(
    {
      game: snapshot(created, [], "w"),
      inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}`,
    },
    { status: 201 },
  );
}
