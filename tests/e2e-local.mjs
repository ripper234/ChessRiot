import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import { Chess } from "chess.js";

const origin = "http://chessriot.test";
const controlOrigin = "https://control.chessriot.test";
const secret = () => randomBytes(32).toString("base64url");
const requestIdForColor = (color) => {
  const id = randomUUID();
  return id.slice(0, -1) + (color === "w" ? "0" : "1");
};
const opsSecret = "local-ops-read-secret-for-e2e-tests";
const opsGrant = (overrides = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    aud: "test",
    scope: "observability:read",
    iat: now,
    exp: now + 120,
    nonce: randomUUID(),
    ...overrides,
  })).toString("base64url");
  return payload + "." + createHmac("sha256", opsSecret).update(payload).digest("base64url");
};
const persistRoot = await mkdtemp(join(tmpdir(), "chessriot-e2e-"));
const serverRoot = resolve("dist/server");

async function listJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listJavaScript(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) paths.push(path);
  }
  return paths;
}

const entryPath = join(serverRoot, "index.js");
const modulePaths = [entryPath, ...(await listJavaScript(serverRoot)).filter((path) => path !== entryPath)];

function createRuntime() {
  return new Miniflare({
    modules: modulePaths.map((path) => ({ type: "ESModule", path })),
    modulesRoot: serverRoot,
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "chessriot-e2e" },
    bindings: {
      CHESSRIOT_ENV: "test",
      CONTROL_ORIGIN: controlOrigin,
      OBSERVABILITY_HASH_SECRET: "local-observability-hash-secret-for-e2e",
      OPS_READ_SECRET: opsSecret,
    },
    defaultPersistRoot: persistRoot,
    d1Persist: true,
  });
}

async function request(runtime, path, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", origin);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return runtime.dispatchFetch(`${origin}${path}`, { ...init, headers });
}

async function body(response) {
  return response.status === 204 ? null : response.json();
}

let runtime = createRuntime();
try {
  const whiteToken = secret();
  const blackToken = secret();
  const thirdToken = secret();
  const inviteToken = secret();
  const createRequestId = randomUUID();

  const createdResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "multiplayer",
      playerToken: whiteToken,
      inviteToken,
      requestId: createRequestId,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  const gameId = created.game.id;
  assert.equal(created.game.status, "waiting");
  assert.equal(created.game.mode, "multiplayer");
  assert.equal(created.game.aiDifficulty, null);
  assert.equal(created.game.turnPaceDays, 3);

  const createRetry = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "multiplayer",
      playerToken: whiteToken,
      inviteToken,
      requestId: createRequestId,
    }),
  });
  assert.equal(createRetry.status, 200);
  assert.equal((await body(createRetry)).game.id, gameId);

  const waitingInvite = await request(runtime, `/api/invitations/${inviteToken}`);
  assert.equal(waitingInvite.status, 200);
  assert.equal((await body(waitingInvite)).state, "waiting");

  const inviteIsNotASeat = await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${inviteToken}` },
  });
  assert.equal(inviteIsNotASeat.status, 404);

  const joinedResponse = await request(runtime, `/api/invitations/${inviteToken}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Omri", playerToken: blackToken }),
  });
  assert.equal(joinedResponse.status, 200);
  const joined = await body(joinedResponse);
  assert.equal(joined.game.you.color, "b");
  assert.equal(joined.game.you.name, "Omri");
  assert.equal(joined.game.players.white.name, "Ron");
  assert.equal(joined.game.players.black.name, "Omri");

  const maliciousReaction = "<script>steal-private-seat</script>";
  const maliciousHeaderRequestId = "private-seat-key-in-request-header";
  const maliciousBodyRequestId = "Player Name and private seat key";
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${whiteToken}`,
      "x-request-id": maliciousHeaderRequestId,
    },
    body: JSON.stringify({ reaction: "hi", requestId: maliciousBodyRequestId }),
  })).status, 400);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: maliciousReaction, requestId: randomUUID() }),
  })).status, 400);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}`, origin: "https://evil.example" },
    body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
  })).status, 403);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${thirdToken}` },
    body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
  })).status, 404);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    headers: { authorization: `Bearer ${thirdToken}` },
  })).status, 404);

  const reactionVersionBefore = joined.game.version;
  const whiteReactionId = randomUUID();
  const whiteReactionResponse = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "hi", requestId: whiteReactionId }),
  });
  assert.equal(whiteReactionResponse.status, 201);
  const whiteReaction = (await body(whiteReactionResponse)).reaction;
  assert.equal(whiteReaction.senderColor, "w");
  assert.equal(whiteReaction.key, "hi");
  assert.equal(typeof whiteReaction.sequence, "number");
  const whiteReactionRetry = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "hi", requestId: whiteReactionId }),
  });
  assert.equal(whiteReactionRetry.status, 200);
  assert.equal((await body(whiteReactionRetry)).reaction.id, whiteReaction.id);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "thanks", requestId: whiteReactionId }),
  })).status, 409);
  assert.equal((await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "nice_move", requestId: randomUUID() }),
  })).status, 429);

  const blackReactionResponse = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${blackToken}` },
    body: JSON.stringify({ reaction: "good_luck", requestId: randomUUID() }),
  });
  assert.equal(blackReactionResponse.status, 201);
  const blackReaction = (await body(blackReactionResponse)).reaction;
  assert.equal(blackReaction.senderColor, "b");
  assert.ok(blackReaction.sequence > whiteReaction.sequence);
  const visibleReactions = await body(await request(runtime, `/api/games/${gameId}/reactions`, {
    headers: { authorization: `Bearer ${blackToken}` },
  }));
  assert.deepEqual(
    visibleReactions.reactions.map((reaction) => reaction.key),
    ["hi", "good_luck"],
  );
  const versionAfterReactions = await body(await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  }));
  assert.equal(versionAfterReactions.game.version, reactionVersionBefore);
  assert.equal(versionAfterReactions.game.plyCount, 0);

  const reactionRaceWhite = secret();
  const reactionRaceInvite = secret();
  const reactionRaceCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Reaction White",
      mode: "multiplayer",
      playerToken: reactionRaceWhite,
      inviteToken: reactionRaceInvite,
      requestId: randomUUID(),
    }),
  }));
  await request(runtime, `/api/invitations/${reactionRaceInvite}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Reaction Black", playerToken: secret() }),
  });
  const concurrentReactionResponses = await Promise.all([
    request(runtime, `/api/games/${reactionRaceCreated.game.id}/reactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${reactionRaceWhite}` },
      body: JSON.stringify({ reaction: "nice_move", requestId: randomUUID() }),
    }),
    request(runtime, `/api/games/${reactionRaceCreated.game.id}/reactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${reactionRaceWhite}` },
      body: JSON.stringify({ reaction: "thanks", requestId: randomUUID() }),
    }),
  ]);
  assert.deepEqual(
    concurrentReactionResponses.map((response) => response.status).sort(),
    [201, 429],
  );

  const joinRetry = await request(runtime, `/api/invitations/${inviteToken}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Omri", playerToken: blackToken }),
  });
  assert.equal(joinRetry.status, 200);

  const claimedInvite = await request(runtime, `/api/invitations/${inviteToken}`);
  assert.equal(claimedInvite.status, 410);
  assert.deepEqual(await body(claimedInvite), { state: "claimed", gameId });

  const inviteReplay = await request(runtime, `/api/invitations/${inviteToken}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Intruder", playerToken: thirdToken }),
  });
  assert.equal(inviteReplay.status, 409);

  const unauthorized = await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${thirdToken}` },
  });
  assert.equal(unauthorized.status, 404);

  const move = async (
    token,
    from,
    to,
    expectedVersion,
    requestId = randomUUID(),
    promotion,
  ) => {
    const response = await request(runtime, `/api/games/${gameId}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from,
        to,
        expectedVersion,
        requestId,
        ...(promotion ? { promotion } : {}),
      }),
    });
    return { response, data: await body(response), requestId };
  };

  assert.equal((await move(blackToken, "e7", "e5", 1)).response.status, 409);
  assert.equal((await move(whiteToken, "e2", "e5", 1)).response.status, 422);
  assert.equal((await move(whiteToken, "e2", "e4", 1, randomUUID(), "q")).response.status, 422);

  const first = await move(whiteToken, "f2", "f3", 1);
  assert.equal(first.response.status, 200);
  assert.equal(first.data.game.version, 2);
  assert.equal((await move(whiteToken, "g2", "g4", 1)).response.status, 409);

  const second = await move(blackToken, "e7", "e5", 2);
  assert.equal(second.response.status, 200);
  const third = await move(whiteToken, "g2", "g4", 3);
  assert.equal(third.response.status, 200);
  const mateRequestId = randomUUID();
  const mate = await move(blackToken, "d8", "h4", 4, mateRequestId);
  assert.equal(mate.response.status, 200);
  assert.equal(mate.data.game.status, "completed");
  assert.equal(mate.data.game.outcome.reason, "checkmate");
  assert.equal(mate.data.game.outcome.winner, "b");
  assert.equal(mate.data.game.moves.length, 4);
  const completedReactionRetry = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "hi", requestId: whiteReactionId }),
  });
  assert.equal(completedReactionRetry.status, 200);
  assert.equal((await body(completedReactionRetry)).reaction.id, whiteReaction.id);
  const reactionDatabase = await runtime.getD1Database("DB");
  await reactionDatabase
    .prepare("UPDATE game_reactions SET created_at = ? WHERE game_id = ?")
    .bind(new Date(Date.now() - 6_000).toISOString(), gameId)
    .run();
  const completedReaction = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "good_game", requestId: randomUUID() }),
  });
  assert.equal(completedReaction.status, 201);
  assert.equal((await body(completedReaction)).reaction.key, "good_game");
  await reactionDatabase
    .prepare("UPDATE games SET finished_at = ?, updated_at = ? WHERE id = ?")
    .bind(
      new Date(Date.now() - 16 * 60 * 1_000).toISOString(),
      new Date(Date.now() - 16 * 60 * 1_000).toISOString(),
      gameId,
    )
    .run();
  const expiredCompletedReaction = await request(runtime, `/api/games/${gameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: JSON.stringify({ reaction: "thanks", requestId: randomUUID() }),
  });
  assert.equal(expiredCompletedReaction.status, 409);
  assert.equal((await body(expiredCompletedReaction)).error.code, "reactions_closed");

  const mateRetry = await move(blackToken, "d8", "h4", 4, mateRequestId);
  assert.equal(mateRetry.response.status, 200);
  assert.equal(mateRetry.data.game.moves.length, 4);
  assert.equal((await move(whiteToken, "e2", "e4", 5)).response.status, 409);

  const whiteState = await body(await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  }));
  const blackState = await body(await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${blackToken}` },
  }));
  assert.equal(whiteState.game.fen, blackState.game.fen);
  assert.equal(whiteState.game.version, 5);
  assert.deepEqual(whiteState.game.you, { color: "w", name: "Ron" });
  assert.deepEqual(blackState.game.you, { color: "b", name: "Omri" });

  await runtime.dispose();
  runtime = createRuntime();
  const afterRestart = await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  });
  assert.equal(afterRestart.status, 200);
  const persisted = await body(afterRestart);
  const persistedReactions = await body(await request(runtime, `/api/games/${gameId}/reactions`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  }));
  assert.equal(persistedReactions.reactions.length, 3);
  assert.equal(persisted.game.version, 5);
  assert.equal(persisted.game.outcome.reason, "checkmate");

  const endWhite = secret();
  const endBlack = secret();
  const endInvite = secret();
  const endCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "White",
      mode: "multiplayer",
      playerToken: endWhite,
      inviteToken: endInvite,
      requestId: randomUUID(),
    }),
  }));
  const endGameId = endCreated.game.id;
  const endJoined = await body(await request(runtime, `/api/invitations/${endInvite}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Black", playerToken: endBlack }),
  }));
  const endRequestId = randomUUID();
  const staleEndResponse = await request(runtime, `/api/games/${endGameId}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${endBlack}` },
    body: JSON.stringify({
      expectedVersion: endJoined.game.version - 1,
      requestId: randomUUID(),
    }),
  });
  assert.equal(staleEndResponse.status, 409);
  assert.equal((await body(staleEndResponse)).error.code, "stale_position");
  const endResponse = await request(runtime, `/api/games/${endGameId}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${endBlack}` },
    body: JSON.stringify({
      expectedVersion: endJoined.game.version,
      requestId: endRequestId,
    }),
  });
  assert.equal(endResponse.status, 200);
  const ended = await body(endResponse);
  assert.equal(ended.game.status, "completed");
  assert.deepEqual(ended.game.outcome, { winner: "w", reason: "resignation" });
  assert.equal(ended.game.moves.length, 0);
  const endRetry = await request(runtime, `/api/games/${endGameId}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${endBlack}` },
    body: JSON.stringify({
      expectedVersion: endJoined.game.version,
      requestId: endRequestId,
    }),
  });
  assert.equal(endRetry.status, 200);
  assert.equal((await body(endRetry)).game.version, ended.game.version);
  assert.equal((await request(runtime, `/api/games/${endGameId}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${thirdToken}` },
    body: JSON.stringify({
      expectedVersion: ended.game.version,
      requestId: randomUUID(),
    }),
  })).status, 404);
  assert.equal((await request(runtime, `/api/games/${endGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${endWhite}` },
    body: JSON.stringify({
      from: "e2",
      to: "e4",
      expectedVersion: ended.game.version,
      requestId: randomUUID(),
    }),
  })).status, 409);

  const cancelToken = secret();
  const cancelInvite = secret();
  const waitingGame = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Waiting",
      mode: "multiplayer",
      playerToken: cancelToken,
      inviteToken: cancelInvite,
      requestId: randomUUID(),
    }),
  }));
  const cancelResponse = await request(runtime, `/api/games/${waitingGame.game.id}/end`, {
    method: "POST",
    headers: { authorization: `Bearer ${cancelToken}` },
    body: JSON.stringify({
      expectedVersion: waitingGame.game.version,
      requestId: randomUUID(),
    }),
  });
  assert.equal(cancelResponse.status, 200);
  assert.deepEqual((await body(cancelResponse)).game.outcome, {
    winner: null,
    reason: "cancelled",
  });
  const cancelledInvite = await request(runtime, `/api/invitations/${cancelInvite}`);
  assert.equal(cancelledInvite.status, 410);
  assert.equal((await body(cancelledInvite)).state, "cancelled");
  const cancelledJoin = await request(runtime, `/api/invitations/${cancelInvite}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Late", playerToken: secret() }),
  });
  assert.equal(cancelledJoin.status, 410);
  assert.equal((await body(cancelledJoin)).error.code, "invite_cancelled");

  const timeoutWhite = secret();
  const timeoutBlack = secret();
  const timeoutInvite = secret();
  const timeoutCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Slow White",
      mode: "multiplayer",
      playerToken: timeoutWhite,
      inviteToken: timeoutInvite,
      requestId: randomUUID(),
    }),
  }));
  const timeoutJoined = await body(await request(
    runtime,
    `/api/invitations/${timeoutInvite}/join`,
    {
      method: "POST",
      body: JSON.stringify({ displayName: "Patient Black", playerToken: timeoutBlack }),
    },
  ));
  assert.match(timeoutJoined.game.deadlineAt, /^\d{4}-\d{2}-\d{2}T/);
  const timeoutDatabase = await runtime.getD1Database("DB");
  await timeoutDatabase
    .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
    .bind("2026-07-20T00:00:00.000Z", timeoutCreated.game.id)
    .run();
  const expiredTurnReaction = await request(
    runtime,
    `/api/games/${timeoutCreated.game.id}/reactions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${timeoutWhite}` },
      body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
    },
  );
  assert.equal(expiredTurnReaction.status, 409);
  assert.equal((await body(expiredTurnReaction)).error.code, "reactions_closed");
  const timedOutResponse = await request(runtime, `/api/games/${timeoutCreated.game.id}`, {
    headers: { authorization: `Bearer ${timeoutWhite}` },
  });
  assert.equal(timedOutResponse.status, 200);
  const timedOut = await body(timedOutResponse);
  assert.equal(timedOut.game.status, "completed");
  assert.deepEqual(timedOut.game.outcome, { winner: "b", reason: "timeout" });
  assert.equal(timedOut.game.deadlineAt, null);
  assert.equal((await request(runtime, `/api/games/${timeoutCreated.game.id}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${timeoutWhite}` },
    body: JSON.stringify({
      from: "e2",
      to: "e4",
      expectedVersion: timeoutJoined.game.version,
      requestId: randomUUID(),
    }),
  })).status, 409);

  const checkWhite = secret();
  const checkBlack = secret();
  const checkInvite = secret();
  const checkCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Checked",
      mode: "multiplayer",
      playerToken: checkWhite,
      inviteToken: checkInvite,
      requestId: randomUUID(),
    }),
  }));
  const checkJoined = await body(await request(runtime, `/api/invitations/${checkInvite}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Attacker", playerToken: checkBlack }),
  }));
  let checkVersion = checkJoined.game.version;
  const checkMove = async (token, from, to) => {
    const response = await request(runtime, `/api/games/${checkCreated.game.id}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from,
        to,
        expectedVersion: checkVersion,
        requestId: randomUUID(),
      }),
    });
    const data = await body(response);
    if (response.ok) checkVersion = data.game.version;
    return { response, data };
  };
  for (const [token, from, to] of [
    [checkWhite, "f2", "f3"],
    [checkBlack, "e7", "e5"],
    [checkWhite, "e1", "f2"],
    [checkBlack, "d8", "h4"],
  ]) {
    assert.equal((await checkMove(token, from, to)).response.status, 200);
  }
  const ignoredCheck = await checkMove(checkWhite, "a2", "a3");
  assert.equal(ignoredCheck.response.status, 422);
  assert.equal(ignoredCheck.data.error.code, "must_answer_check");
  const answeredCheck = await checkMove(checkWhite, "g2", "g3");
  assert.equal(answeredCheck.response.status, 200);
  assert.equal(answeredCheck.data.game.check, false);

  const invalidDifficulty = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "solo",
      difficulty: 6,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(invalidDifficulty.status, 400);
  const invalidTurnPace = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "multiplayer",
      turnPaceDays: 2,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(invalidTurnPace.status, 400);

  const soloToken = secret();
  const soloInvite = secret();
  const soloRequestId = requestIdForColor("w");
  const soloCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "solo",
      difficulty: 3,
      playerToken: soloToken,
      inviteToken: soloInvite,
      requestId: soloRequestId,
    }),
  });
  assert.equal(soloCreatedResponse.status, 201);
  const soloCreated = await body(soloCreatedResponse);
  const soloGameId = soloCreated.game.id;
  assert.equal(soloCreated.inviteUrl, undefined);
  assert.equal(soloCreated.game.mode, "solo");
  assert.equal(soloCreated.game.aiDifficulty, 3);
  assert.equal(soloCreated.game.status, "active");
  assert.equal(soloCreated.game.you.color, "w");
  assert.equal(soloCreated.game.players.black.name, "Riot Bot");
  assert.equal(soloCreated.game.version, 0);
  assert.equal((await request(runtime, `/api/games/${soloGameId}/reactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${soloToken}` },
    body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
  })).status, 409);
  assert.equal((await request(runtime, `/api/games/${soloGameId}/reactions`, {
    headers: { authorization: `Bearer ${soloToken}` },
  })).status, 409);

  const soloInviteCannotBeClaimed = await request(runtime, `/api/invitations/${soloInvite}`);
  assert.equal(soloInviteCannotBeClaimed.status, 410);

  const soloMoveId = randomUUID();
  const soloMoveResponse = await request(runtime, `/api/games/${soloGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${soloToken}` },
    body: JSON.stringify({
      from: "e2",
      to: "e4",
      expectedVersion: 0,
      requestId: soloMoveId,
    }),
  });
  assert.equal(soloMoveResponse.status, 200);
  const soloAfterHumanMove = await body(soloMoveResponse);
  assert.equal(soloAfterHumanMove.game.version, 1);
  assert.equal(soloAfterHumanMove.game.plyCount, 1);
  assert.equal(soloAfterHumanMove.game.turn, "b");
  assert.equal(soloAfterHumanMove.game.moves.length, 1);
  assert.equal(soloAfterHumanMove.game.moves[0].color, "w");

  const soloRetryResponse = await request(runtime, `/api/games/${soloGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${soloToken}` },
    body: JSON.stringify({
      from: "e2",
      to: "e4",
      expectedVersion: 0,
      requestId: soloMoveId,
    }),
  });
  assert.equal(soloRetryResponse.status, 200);
  assert.equal((await body(soloRetryResponse)).game.moves.length, 1);

  // The human ply is durable before the bot starts. Reopening the game on a
  // fresh runtime recovers and commits the pending bot turn.
  await runtime.dispose();
  runtime = createRuntime();
  const soloAfterRestart = await body(await request(runtime, `/api/games/${soloGameId}`, {
    headers: { authorization: `Bearer ${soloToken}` },
  }));
  assert.equal(soloAfterRestart.game.version, 2);
  assert.equal(soloAfterRestart.game.moves.length, 2);
  assert.equal(soloAfterRestart.game.turn, "w");

  const blackSoloToken = secret();
  const blackSoloInvite = secret();
  const blackSoloCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Ron",
      mode: "solo",
      difficulty: 3,
      playerToken: blackSoloToken,
      inviteToken: blackSoloInvite,
      requestId: requestIdForColor("b"),
    }),
  });
  assert.equal(blackSoloCreatedResponse.status, 201);
  const blackSoloCreated = await body(blackSoloCreatedResponse);
  const blackSoloGameId = blackSoloCreated.game.id;
  assert.equal(blackSoloCreated.game.you.color, "b");
  assert.equal(blackSoloCreated.game.players.white.name, "Riot Bot");
  assert.equal(blackSoloCreated.game.players.black.name, "Ron");
  assert.equal(blackSoloCreated.game.version, 1);
  assert.equal(blackSoloCreated.game.plyCount, 1);
  assert.equal(blackSoloCreated.game.moves[0].color, "w");
  assert.equal(blackSoloCreated.game.turn, "b");

  const blackPosition = new Chess(blackSoloCreated.game.fen);
  const blackReply = blackPosition.moves({ verbose: true })[0];
  const blackReplyResponse = await request(runtime, `/api/games/${blackSoloGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${blackSoloToken}` },
    body: JSON.stringify({
      from: blackReply.from,
      to: blackReply.to,
      ...(blackReply.promotion ? { promotion: blackReply.promotion } : {}),
      expectedVersion: 1,
      requestId: randomUUID(),
    }),
  });
  assert.equal(blackReplyResponse.status, 200);
  const blackSoloAfterHumanReply = await body(blackReplyResponse);
  assert.equal(blackSoloAfterHumanReply.game.version, 2);
  assert.equal(blackSoloAfterHumanReply.game.plyCount, 2);
  assert.equal(blackSoloAfterHumanReply.game.moves[1].color, "b");
  assert.equal(blackSoloAfterHumanReply.game.turn, "w");

  const concurrentBotReads = await Promise.all([
    request(runtime, `/api/games/${blackSoloGameId}`, {
      headers: { authorization: `Bearer ${blackSoloToken}` },
    }),
    request(runtime, `/api/games/${blackSoloGameId}`, {
      headers: { authorization: `Bearer ${blackSoloToken}` },
    }),
  ]);
  assert.deepEqual(concurrentBotReads.map((response) => response.status), [200, 200]);
  const concurrentBotStates = await Promise.all(concurrentBotReads.map(body));
  for (const state of concurrentBotStates) {
    assert.equal(state.game.version, 3);
    assert.equal(state.game.plyCount, 3);
    assert.equal(state.game.moves[1].color, "b");
    assert.equal(state.game.moves[2].color, "w");
    assert.equal(state.game.turn, "b");
  }

  const repetitionWhite = secret();
  const repetitionBlack = secret();
  const repetitionInvite = secret();
  const repetitionCreate = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "White",
      mode: "multiplayer",
      playerToken: repetitionWhite,
      inviteToken: repetitionInvite,
      requestId: randomUUID(),
    }),
  }));
  const repetitionGameId = repetitionCreate.game.id;
  const repetitionJoin = await body(await request(
    runtime,
    `/api/invitations/${repetitionInvite}/join`,
    {
      method: "POST",
      body: JSON.stringify({ displayName: "Black", playerToken: repetitionBlack }),
    },
  ));
  let repetitionVersion = repetitionJoin.game.version;
  const repetitionMove = async (token, from, to, requestId = randomUUID()) => {
    const response = await request(runtime, `/api/games/${repetitionGameId}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from,
        to,
        expectedVersion: repetitionVersion,
        requestId,
      }),
    });
    const data = await body(response);
    if (response.ok) repetitionVersion = data.game.version;
    return { response, data };
  };
  const concurrentId = randomUUID();
  const concurrentVersion = repetitionVersion;
  const concurrentMove = () => request(runtime, `/api/games/${repetitionGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${repetitionWhite}` },
    body: JSON.stringify({
      from: "g1",
      to: "f3",
      expectedVersion: concurrentVersion,
      requestId: concurrentId,
    }),
  });
  const concurrentResponses = await Promise.all([concurrentMove(), concurrentMove()]);
  assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
  const concurrentStates = await Promise.all(concurrentResponses.map(body));
  assert.equal(concurrentStates[0].game.moves.length, 1);
  assert.equal(concurrentStates[1].game.moves.length, 1);
  repetitionVersion = concurrentStates[0].game.version;
  for (const [token, from, to] of [
    [repetitionBlack, "g8", "f6"],
    [repetitionWhite, "f3", "g1"],
    [repetitionBlack, "f6", "g8"],
    [repetitionWhite, "g1", "f3"],
    [repetitionBlack, "g8", "f6"],
    [repetitionWhite, "f3", "g1"],
    [repetitionBlack, "f6", "g8"],
  ]) {
    const result = await repetitionMove(token, from, to);
    assert.equal(result.response.status, 200);
  }
  const repetitionState = await body(await request(
    runtime,
    `/api/games/${repetitionGameId}`,
    { headers: { authorization: `Bearer ${repetitionWhite}` } },
  ));
  assert.deepEqual(repetitionState.game.claimableDraws, ["threefold_repetition"]);
  const claimResponse = await request(runtime, `/api/games/${repetitionGameId}/claims`, {
    method: "POST",
    headers: { authorization: `Bearer ${repetitionWhite}` },
    body: JSON.stringify({
      claim: "threefold_repetition",
      expectedVersion: repetitionVersion,
      requestId: randomUUID(),
    }),
  });
  assert.equal(claimResponse.status, 200);
  const claimed = await body(claimResponse);
  assert.equal(claimed.game.status, "completed");
  assert.equal(claimed.game.outcome.reason, "threefold_repetition");

  const healthResponse = await request(runtime, "/api/health");
  assert.equal(healthResponse.status, 200);
  const health = await body(healthResponse);
  assert.equal(health.environment, "test");
  assert.equal(health.database, "ok");
  const controlHealthResponse = await request(runtime, "/api/health", {
    headers: { origin: controlOrigin },
  });
  assert.equal(controlHealthResponse.headers.get("access-control-allow-origin"), controlOrigin);
  assert.equal(controlHealthResponse.headers.get("access-control-allow-credentials"), "true");

  const feedbackTitle = "Make captures feel chunkier";
  const feedbackComment = "A short burst is enough.";
  const feedbackRequestId = randomUUID();
  assert.equal((await request(runtime, "/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      title: "",
      comment: feedbackComment,
      page: "/g/private-game?secret=never-store-this",
      requestId: randomUUID(),
    }),
  })).status, 400);
  const feedbackResponse = await request(runtime, "/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      title: feedbackTitle,
      comment: feedbackComment,
      page: "/g/game-id?ignored=yes",
      requestId: feedbackRequestId,
    }),
  });
  assert.equal(feedbackResponse.status, 201);
  assert.equal((await body(feedbackResponse)).status, "received");
  const feedbackRetry = await request(runtime, "/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      title: feedbackTitle,
      comment: feedbackComment,
      page: "/g/game-id",
      requestId: feedbackRequestId,
    }),
  });
  assert.equal(feedbackRetry.status, 200);

  const overviewResponse = await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant(),
  });
  assert.equal(overviewResponse.status, 200);
  assert.equal(overviewResponse.headers.get("access-control-allow-origin"), controlOrigin);
  assert.equal(overviewResponse.headers.get("access-control-allow-credentials"), "true");
  const overview = await body(overviewResponse);
  assert.equal(overview.environment, "test");
  assert.ok(overview.totals.total > 0);
  assert.ok(overview.breakdown.some((row) => row.event_name === "move.submitted"));
  assert.ok(overview.breakdown.some((row) => row.event_name === "game.ended"));
  assert.ok(overview.breakdown.some((row) =>
    row.event_name === "reaction.sent" && row.outcome === "success" && row.count === 4));
  assert.ok(overview.breakdown.some((row) =>
    row.event_name === "reaction.retry" && row.outcome === "success" && row.count === 2));
  assert.ok(overview.breakdown.every((row) => row.event_name !== "system.health_checked"));
  assert.ok(overview.breakdown.every((row) => row.event_name !== "observability.viewed"));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(soloToken)));
  assert.equal(overview.feedback[0].title, feedbackTitle);
  assert.equal(overview.feedback[0].comment, feedbackComment);
  assert.equal(overview.feedback[0].page, "/g/game-id");
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackTitle)));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackComment)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousReaction)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousHeaderRequestId)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousBodyRequestId)));
  const observabilityDatabase = await runtime.getD1Database("DB");
  const moveTelemetry = await observabilityDatabase
    .prepare(`SELECT metadata_json FROM observability_events
      WHERE event_name IN ('move.submitted', 'bot.move_committed')`)
    .all();
  assert.ok(moveTelemetry.results.length > 0);
  for (const event of moveTelemetry.results) {
    const metadata = JSON.parse(event.metadata_json);
    assert.equal(Object.hasOwn(metadata, "from"), false);
    assert.equal(Object.hasOwn(metadata, "to"), false);
    assert.equal(Object.hasOwn(metadata, "promotion"), false);
  }

  const validGrant = opsGrant();
  const tamperedGrant = validGrant.slice(0, -1) + (validGrant.endsWith("a") ? "b" : "a");
  assert.equal((await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: tamperedGrant,
  })).status, 403);
  const expiredAt = Math.floor(Date.now() / 1000) - 10;
  assert.equal((await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ iat: expiredAt - 120, exp: expiredAt }),
  })).status, 403);
  assert.equal((await runtime.dispatchFetch(`${origin}/api/ops/overview`, {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "text/plain" },
    body: opsGrant(),
  })).status, 403);

  console.log("E2E passed: rules, both Solo colors, concurrency, draw claims, observability, and persistence");
} finally {
  await runtime.dispose();
  await rm(persistRoot, { recursive: true, force: true });
}

process.exit(0);
