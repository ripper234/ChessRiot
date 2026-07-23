import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";

const origin = "http://chessriot.test";
const secret = () => randomBytes(32).toString("base64url");
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
    body: JSON.stringify({ displayName: "Ron", playerToken: whiteToken, inviteToken, requestId: createRequestId }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  const gameId = created.game.id;
  assert.equal(created.game.status, "waiting");

  const createRetry = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({ displayName: "Ron", playerToken: whiteToken, inviteToken, requestId: createRequestId }),
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

  const move = async (token, from, to, expectedVersion, requestId = randomUUID()) => {
    const response = await request(runtime, `/api/games/${gameId}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ from, to, expectedVersion, requestId }),
    });
    return { response, data: await body(response), requestId };
  };

  assert.equal((await move(blackToken, "e7", "e5", 1)).response.status, 409);
  assert.equal((await move(whiteToken, "e2", "e5", 1)).response.status, 422);

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

  console.log("E2E passed: two players, security, stale writes, checkmate, and cold-start persistence");
} finally {
  await runtime.dispose();
  await rm(persistRoot, { recursive: true, force: true });
}

process.exit(0);
