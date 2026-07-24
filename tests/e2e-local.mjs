import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import { Chess } from "chess.js";

const origin = "http://chessriot.test";
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
      CONTROL_ORIGIN: origin,
      OBSERVABILITY_HASH_SECRET: "local-observability-hash-secret-for-e2e",
      OPS_READ_SECRET: opsSecret,
    },
    defaultPersistRoot: persistRoot,
    d1Persist: true,
  });
}

async function request(runtime, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
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
  assert.equal((await body(joinedResponse)).game.you.color, "b");

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

  await runtime.dispose();
  runtime = createRuntime();
  const afterRestart = await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  });
  assert.equal(afterRestart.status, 200);
  const persisted = await body(afterRestart);
  assert.equal(persisted.game.version, 5);
  assert.equal(persisted.game.outcome.reason, "checkmate");

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
  const soloAfterMove = await body(soloMoveResponse);
  assert.equal(soloAfterMove.game.version, 2);
  assert.equal(soloAfterMove.game.plyCount, 2);
  assert.equal(soloAfterMove.game.turn, "w");
  assert.equal(soloAfterMove.game.moves[0].color, "w");
  assert.equal(soloAfterMove.game.moves[1].color, "b");

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
  assert.equal((await body(soloRetryResponse)).game.moves.length, 2);

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
  const blackSoloAfterReply = await body(blackReplyResponse);
  assert.equal(blackSoloAfterReply.game.version, 3);
  assert.equal(blackSoloAfterReply.game.plyCount, 3);
  assert.equal(blackSoloAfterReply.game.moves[1].color, "b");
  assert.equal(blackSoloAfterReply.game.moves[2].color, "w");
  assert.equal(blackSoloAfterReply.game.turn, "b");

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
    headers: { "content-type": "text/plain" },
    body: opsGrant(),
  });
  assert.equal(overviewResponse.status, 200);
  const overview = await body(overviewResponse);
  assert.equal(overview.environment, "test");
  assert.ok(overview.totals.total > 0);
  assert.ok(overview.breakdown.some((row) => row.event_name === "move.submitted"));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(soloToken)));
  assert.equal(overview.feedback[0].title, feedbackTitle);
  assert.equal(overview.feedback[0].comment, feedbackComment);
  assert.equal(overview.feedback[0].page, "/g/game-id");
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackTitle)));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackComment)));

  const validGrant = opsGrant();
  const tamperedGrant = validGrant.slice(0, -1) + (validGrant.endsWith("a") ? "b" : "a");
  assert.equal((await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: tamperedGrant,
  })).status, 403);
  const expiredAt = Math.floor(Date.now() / 1000) - 10;
  assert.equal((await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain" },
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
