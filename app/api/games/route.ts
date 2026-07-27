import { chooseComputerMove } from "@/lib/computer-player";
import { applyCandidate, INITIAL_FEN } from "@/lib/game-rules";
import {
  accountPlayerColor,
  findGameByCreateRequest,
  playerColor,
  readMoves,
  snapshot,
  type GameRow,
} from "@/lib/game-store";
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
import type { AiDifficulty, Color, TurnPaceDays } from "@/lib/game-types";
import { recordEvent } from "@/lib/observability";
import { enforceAccountRateLimit, resolveGuestApiAccount } from "@/lib/accounts";
import {
  normalizeMagicPrompt,
  serializeMagicRules,
  type CompiledMagicRules,
} from "@/lib/magic-rules";
import { compileMagicPromptCached } from "@/lib/magic-rules-compiler";
import { serializeMoveContinuation } from "@/lib/move-continuation";
import {
  acquireGameCreateIntent,
  gameCreateFingerprint,
  releaseGameCreateIntent,
} from "@/lib/game-create-intent";

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
  const guestToken = body.guestToken;
  const playerToken = body.playerToken;
  const inviteToken = body.inviteToken;
  const requestId = body.requestId;
  if (
    !displayName
    || !isSecret(guestToken)
    || !isSecret(playerToken)
    || !isSecret(inviteToken)
    || !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "Name, secrets, or request id are invalid");
  }
  const mode = body.mode === undefined ? "multiplayer" : body.mode;
  const difficulty = mode === "solo"
    ? body.difficulty === undefined ? 3 : body.difficulty
    : null;
  const turnPaceDays = mode === "multiplayer"
    ? body.turnPaceDays === undefined ? 3 : body.turnPaceDays
    : null;
  let magicPrompt: string | null = null;
  if (body.magicPrompt !== undefined && body.magicPrompt !== null && body.magicPrompt !== "") {
    const normalized = normalizeMagicPrompt(body.magicPrompt);
    if (!normalized.ok) {
      return apiError(422, "magic_rule_invalid", normalized.message);
    }
    magicPrompt = normalized.prompt;
  }
  const turnPaceMatches = (value: number | null) =>
    value === turnPaceDays
    || (mode === "multiplayer" && body.turnPaceDays === undefined && value === null);
  if (
    !isGameMode(mode)
    || (mode === "solo" && !isAiDifficulty(difficulty))
    || (mode === "multiplayer" && !isTurnPaceDays(turnPaceDays))
  ) {
    return apiError(400, "invalid_request", "Game mode, bot level, or turn pace is invalid");
  }
  if (playerToken === inviteToken) return apiError(400, "invalid_request", "Secrets must be different");

  const account = await resolveGuestApiAccount({
    token: guestToken,
    displayName,
  });

  await ensureSchema();
  const [playerHash, inviteHash] = await Promise.all([hashSecret(playerToken), hashSecret(inviteToken)]);
  const matchesCreateRequest = async (candidate: GameRow): Promise<boolean> => {
    const existingColor = await accountPlayerColor(candidate, account.id, playerHash);
    return humanName(candidate) === displayName
      && playerColor(candidate, playerHash) === candidate.human_color
      && existingColor === candidate.human_color
      && candidate.invite_token_hash === inviteHash
      && candidate.game_mode === mode
      && candidate.ai_difficulty === difficulty
      && turnPaceMatches(candidate.turn_pace_days)
      && candidate.magic_prompt === magicPrompt;
  };
  const completedCreateResponse = async (candidate: GameRow) => json({
    game: snapshot(candidate, await readMoves(candidate.id), candidate.human_color),
    ...(mode === "multiplayer"
      ? { inviteUrl: `${new URL(request.url).origin}/join/${inviteToken}` }
      : {}),
  });
  const existing = await findGameByCreateRequest(requestId);
  if (existing) {
    if (!(await matchesCreateRequest(existing))) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return completedCreateResponse(existing);
  }

  const db = getDatabase();
  const createFingerprint = await gameCreateFingerprint({
    accountId: account.id,
    displayName,
    playerHash,
    inviteHash,
    mode,
    difficulty: difficulty as AiDifficulty | null,
    turnPaceDays: turnPaceDays as TurnPaceDays | null,
    magicPrompt,
  });
  const createIntent = await acquireGameCreateIntent(
    db,
    requestId,
    createFingerprint,
  );
  if (createIntent.status === "completed") {
    const completed = await findGameByCreateRequest(requestId);
    if (!completed) {
      return json(
        { error: { code: "game_create_pending", message: "The game is finishing creation." } },
        { status: 503, headers: { "retry-after": "1" } },
      );
    }
    if (!(await matchesCreateRequest(completed))) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return completedCreateResponse(completed);
  }
  if (createIntent.status === "conflict") {
    return apiError(409, "idempotency_conflict", "This request id is already being used");
  }
  if (createIntent.status === "pending") {
    return json(
      {
        error: {
          code: "game_create_pending",
          message: "That game is already being created. Try again in a moment.",
        },
      },
      {
        status: 503,
        headers: { "retry-after": String(createIntent.retryAfter) },
      },
    );
  }

  try {
    const completedAfterLease = await findGameByCreateRequest(requestId);
    if (completedAfterLease) {
      if (!(await matchesCreateRequest(completedAfterLease))) {
        return apiError(409, "idempotency_conflict", "This request id was already used");
      }
      return completedCreateResponse(completedAfterLease);
    }

    const rate = await enforceAccountRateLimit(account.id, "game_create", 10, 60 * 60);
    if (!rate.allowed) {
      return json(
        { error: { code: "rate_limited", message: "Too many games created. Try again later." } },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }

    let magicRules: CompiledMagicRules | null = null;
    if (magicPrompt) {
      const compilation = await compileMagicPromptCached(magicPrompt);
      if (!compilation.ok) {
        const code = compilation.code === "ambiguous"
          ? "magic_rule_ambiguous"
          : compilation.code === "unsupported"
            ? "magic_rule_unsupported"
            : compilation.code === "invalid_prompt"
              ? "magic_rule_invalid"
              : "magic_rule_unavailable";
        return json(
          { error: { code, message: compilation.message } },
          {
            status: compilation.code === "unavailable" ? 503 : 422,
            ...(compilation.code === "unavailable"
              ? { headers: { "retry-after": "2" } }
              : {}),
          },
        );
      }
      magicRules = compilation.compiled;
    }
    const magicRulesJson = serializeMagicRules(magicRules);

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
      ? chooseComputerMove(
        INITIAL_FEN,
        difficulty as AiDifficulty,
        computerColor,
        Math.random,
        magicRules,
      )
      : null;
    if (mode === "solo" && computerColor === "w" && !openingCandidate) {
      return apiError(500, "computer_move_failed", "The computer could not open the game");
    }
    const opening = openingCandidate
      ? applyCandidate(INITIAL_FEN, [], openingCandidate, magicRules)
      : null;
    const initialVersion = opening ? 1 : 0;
    const initialPly = opening ? 1 : 0;
    const currentFen = opening?.fenAfter ?? INITIAL_FEN;
    const turnColor = opening?.turn ?? "w";
    const commitStartedAt = Date.now();
    const writes = [
      db.prepare(`INSERT INTO games (
        id, create_request_id, status, white_name, black_name, white_token_hash,
        black_token_hash, invite_token_hash, initial_fen, current_fen, turn_color, version, ply_count,
        created_at, joined_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM game_create_intents
        WHERE request_id = ? AND fingerprint = ? AND lease_token = ?
          AND lease_until > ?`)
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
          requestId,
          createFingerprint,
          createIntent.leaseToken,
          commitStartedAt,
        ),
      db.prepare(`INSERT INTO game_settings (
        game_id, game_mode, ai_difficulty, human_color, turn_pace_days,
        magic_prompt, magic_rules_json
      ) SELECT ?, ?, ?, ?, ?, ?, ?
        FROM games WHERE id = ? AND create_request_id = ?`)
        .bind(
          id,
          mode,
          difficulty,
          humanColor,
          turnPaceDays,
          magicPrompt,
          magicRulesJson,
          id,
          requestId,
        ),
      db.prepare(`INSERT INTO game_memberships (
        game_id, color, account_id, claimed_at
      ) SELECT ?, ?, ?, ?
        FROM games WHERE id = ? AND create_request_id = ?`)
        .bind(id, humanColor, account.id, now, id, requestId),
    ];
    if (opening && openingCandidate && computerColor) {
      writes.push(
        db.prepare(`INSERT INTO moves (
          game_id, ply, request_id, color, from_square, to_square, promotion,
          san, second_from_square, second_to_square, second_san,
          continuation_json, fen_before, fen_after, created_at
        ) SELECT ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM games WHERE id = ? AND create_request_id = ?`)
          .bind(
            id,
            crypto.randomUUID(),
            computerColor,
            openingCandidate.from,
            openingCandidate.to,
            openingCandidate.promotion ?? null,
            opening.move.san,
            openingCandidate.second?.from ?? null,
            openingCandidate.second?.to ?? null,
            opening.secondMove?.san ?? null,
            serializeMoveContinuation(opening.continuationMoves),
            opening.fenBefore,
            opening.fenAfter,
            now,
            id,
            requestId,
          ),
      );
    }
    writes.push(
      db.prepare(`DELETE FROM game_create_intents
        WHERE request_id = ? AND fingerprint = ? AND lease_token = ?`)
        .bind(requestId, createFingerprint, createIntent.leaseToken),
    );
    let results: D1Result<unknown>[];
    try {
      results = await db.batch(writes);
    } catch {
      const raced = await findGameByCreateRequest(requestId);
      if (!raced || !(await matchesCreateRequest(raced))) {
        return apiError(409, "idempotency_conflict", "Could not create this game");
      }
      return completedCreateResponse(raced);
    }
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      const raced = await findGameByCreateRequest(requestId);
      if (raced) {
        if (!(await matchesCreateRequest(raced))) {
          return apiError(409, "idempotency_conflict", "This request id was already used");
        }
        return completedCreateResponse(raced);
      }
      return json(
        {
          error: {
            code: "game_create_pending",
            message: "The create lease changed. Try again in a moment.",
          },
        },
        { status: 503, headers: { "retry-after": "1" } },
      );
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
          magic: Boolean(magicRules),
          ruleCount: magicRules?.rules.length ?? 0,
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
  } finally {
    try {
      await releaseGameCreateIntent(
        db,
        requestId,
        createFingerprint,
        createIntent.leaseToken,
      );
    } catch {
      // The short lease permits a safe retry if best-effort cleanup is unavailable.
    }
  }
}
