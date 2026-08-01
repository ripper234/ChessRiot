import { chooseComputerMove } from "@/lib/computer-player";
import { applyCandidate } from "@/lib/game-rules";
import {
  accountPlayerColor,
  findGameByCreateRequest,
  playerColor,
  readMoves,
  snapshot,
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
import type { Color } from "@/lib/game-types";
import type { AiDifficulty } from "@/lib/game-types";
import { recordEvent } from "@/lib/observability";
import { applicationOrigin } from "@/lib/runtime";
import { enforceAccountRateLimit, resolveGuestApiAccount } from "@/lib/accounts";
import {
  compileMagicPrompt,
  serializeMagicRules,
  type CompiledMagicRules,
} from "@/lib/magic-rules";
import {
  gameVariant,
  isGameVariantId,
} from "@/lib/game-variants";

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
  if (!isGameMode(mode)) {
    return apiError(400, "invalid_request", "Game mode, bot level, or turn pace is invalid");
  }
  const variantId = body.variantId === undefined ? "standard" : body.variantId;
  if (!isGameVariantId(variantId)) {
    return apiError(400, "invalid_variant", "Choose one of the available games");
  }
  const variant = gameVariant(variantId);
  if (variant.soloOnly && mode !== "solo") {
    return apiError(
      422,
      "variant_mode_conflict",
      "Mating Set challenges are Solo practice",
    );
  }
  const initialFen = variant.initialFen;
  const difficulty = mode === "solo"
    ? body.difficulty === undefined ? 3 : body.difficulty
    : null;
  const turnPaceDays = mode === "multiplayer"
    ? body.turnPaceDays === undefined ? 3 : body.turnPaceDays
    : null;
  let magicPrompt: string | null = null;
  let magicRules: CompiledMagicRules | null = null;
  const requestedMagic = body.magicPrompt !== undefined
    && body.magicPrompt !== null
    && body.magicPrompt !== "";
  if (requestedMagic) {
    if (variantId !== "standard") {
      return apiError(
        422,
        "variant_magic_conflict",
        "Mini Games use their own fixed setup and cannot add Magic Rules",
      );
    }
  }
  let magicRulesJson = serializeMagicRules(magicRules);
  const turnPaceMatches = (value: number | null) =>
    value === turnPaceDays
    || (mode === "multiplayer" && body.turnPaceDays === undefined && value === null);
  if (
    (mode === "solo" && !isAiDifficulty(difficulty))
    || (mode === "multiplayer" && !isTurnPaceDays(turnPaceDays))
  ) {
    return apiError(400, "invalid_request", "Game mode, bot level, or turn pace is invalid");
  }
  if (playerToken === inviteToken) return apiError(400, "invalid_request", "Secrets must be different");

  const account = await resolveGuestApiAccount({
    token: guestToken,
    displayName,
  });
  const rate = await enforceAccountRateLimit(account.id, "game_create", 10, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many games created. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  await ensureSchema();
  const [playerHash, inviteHash] = await Promise.all([hashSecret(playerToken), hashSecret(inviteToken)]);
  const existing = await findGameByCreateRequest(requestId);
  if (requestedMagic) {
    if (!existing) {
      return apiError(
        422,
        "magic_rules_unavailable",
        "Magic Rules are coming soon and cannot create stable games yet",
      );
    }
    const magic = compileMagicPrompt(body.magicPrompt);
    if (!magic.ok) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    magicPrompt = magic.prompt;
    magicRules = magic.compiled;
    magicRulesJson = serializeMagicRules(magicRules);
  }
  if (existing) {
    const existingColor = await accountPlayerColor(existing, account.id, playerHash);
    if (
      humanName(existing) !== displayName ||
      playerColor(existing, playerHash) !== existing.human_color ||
      existingColor !== existing.human_color ||
      existing.invite_token_hash !== inviteHash ||
      existing.game_mode !== mode ||
      existing.variant_id !== variantId ||
      existing.initial_fen !== initialFen ||
      existing.ai_difficulty !== difficulty ||
      !turnPaceMatches(existing.turn_pace_days) ||
      existing.magic_prompt !== magicPrompt ||
      existing.magic_rules_json !== magicRulesJson
    ) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    const game = snapshot(existing, await readMoves(existing.id), existing.human_color);
    return json({
      game,
      ...(mode === "multiplayer"
        ? { inviteUrl: `${applicationOrigin(request)}/join/${inviteToken}` }
        : {}),
    });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = mode === "solo" ? "active" : "waiting";
  const humanColor: Color = mode === "solo"
    ? variant.humanColor ?? assignedSoloColor(requestId)
    : "w";
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
      initialFen,
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
    ? applyCandidate(initialFen, [], openingCandidate, magicRules)
    : null;
  const initialVersion = opening ? 1 : 0;
  const initialPly = opening ? 1 : 0;
  const currentFen = opening?.fenAfter ?? initialFen;
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
          initialFen,
          currentFen,
          turnColor,
          initialVersion,
          initialPly,
          now,
          joinedAt,
          now,
        ),
      db.prepare(`INSERT INTO game_settings (
        game_id, game_mode, variant_id, ai_difficulty, human_color, turn_pace_days,
        magic_prompt, magic_rules_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          mode,
          variantId,
          difficulty,
          humanColor,
          turnPaceDays,
          magicPrompt,
          magicRulesJson,
        ),
      db.prepare(`INSERT INTO game_memberships (
        game_id, color, account_id, claimed_at
      ) VALUES (?, ?, ?, ?)`)
        .bind(id, humanColor, account.id, now),
    ];
    if (opening && openingCandidate && computerColor) {
      writes.push(
        db.prepare(`INSERT INTO moves (
          game_id, ply, request_id, color, from_square, to_square, promotion,
          san, second_from_square, second_to_square, second_san,
          fen_before, fen_after, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      await accountPlayerColor(raced, account.id, playerHash) !== raced.human_color ||
      raced.invite_token_hash !== inviteHash ||
      raced.game_mode !== mode ||
      raced.variant_id !== variantId ||
      raced.initial_fen !== initialFen ||
      raced.ai_difficulty !== difficulty ||
      !turnPaceMatches(raced.turn_pace_days) ||
      raced.magic_prompt !== magicPrompt ||
      raced.magic_rules_json !== magicRulesJson
    ) {
      return apiError(409, "idempotency_conflict", "Could not create this game");
    }
    return json({
      game: snapshot(raced, await readMoves(raced.id), raced.human_color),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${applicationOrigin(request)}/join/${inviteToken}` }
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
        variantId,
        magic: Boolean(magicRules),
        ruleCount: magicRules?.rules.length ?? 0,
      },
    });
  }
  return json(
    {
      game: snapshot(created, await readMoves(created.id), created.human_color),
      ...(mode === "multiplayer"
        ? { inviteUrl: `${applicationOrigin(request)}/join/${inviteToken}` }
        : {}),
    },
    { status: 201 },
  );
}
