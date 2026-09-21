// Independent audit fixture proposal. Copy into tests/ and inject the existing E2E helpers.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Chess } from "chess.js";

export async function verifyPremoves({ createRuntime, request, body, accountForLabel, usernameForAccount, secret, pushClientPublicKey, waitFor }) {
  const runtime = createRuntime({ databaseName: "premoves-e2e", outboundService: async () => new Response(null, { status: 201 }) });
  try {
    const white = accountForLabel("Premove White");
    const black = accountForLabel("Premove Black");
    const outsider = accountForLabel("Premove Other");
    const identity = (who) => ({ accountEmail: who.email, accountName: who.displayName });
    const call = (path, who, method = "GET", payload) => request(runtime, path, { ...identity(who), method, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const ok = async (response, status = 200) => { const data = await body(response); assert.equal(response.status, status, JSON.stringify(data)); return data; };
    for (const who of [white, black]) {
      await ok(await call("/api/me/friends", who));
      await ok(await call("/api/me/push-devices", who, "PUT", {
        requestId: randomUUID(), expectedUsername: usernameForAccount(who),
        subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${secret()}`, expirationTime: null,
          keys: { p256dh: pushClientPublicKey, auth: randomBytes(16).toString("base64url") } },
      }));
    }
    const db = await runtime.getD1Database("DB");
    async function create({ fen, join = true, mode = "multiplayer" } = {}) {
      const inviteToken = secret();
      let game = (await ok(await call("/api/games", white, "POST", {
        mode, variantId: "standard", ...(mode === "multiplayer" ? { turnPaceDays: 3 } : { difficulty: 1 }),
        playerToken: secret(), inviteToken, requestId: randomUUID(),
      }), 201)).game;
      if (fen) {
        const turn = new Chess(fen).turn();
        await db.prepare("UPDATE games SET initial_fen = ?, current_fen = ?, turn_color = ? WHERE id = ?")
          .bind(fen, fen, turn, game.id).run();
      }
      if (join && mode === "multiplayer") game = (await ok(await call(`/api/invitations/${inviteToken}/join`, black, "POST", { playerToken: secret() }))).game;
      return game;
    }
    const movePayload = (game, from, to, requestId = randomUUID()) => ({ from, to, expectedVersion: game.version, requestId });
    const play = async (game, who, from, to) => (await ok(await call(`/api/games/${game.id}/moves`, who, "POST", movePayload(game, from, to)))).game;
    const queuePayload = (game, revision, move, requestId = randomUUID()) => ({ expectedVersion: game.version, expectedRevision: revision, requestId, move });
    const put = (game, who, payload) => call(`/api/games/${game.id}/premove`, who, "PUT", payload);
    const own = async (game, who) => (await ok(await call(`/api/games/${game.id}`, who))).game;
    const deliveries = async (gameId, afterVersion) => (await db.prepare(`SELECT deliveries.game_version, members.color AS target_color, deliveries.status
      FROM push_turn_deliveries AS deliveries JOIN push_devices AS devices ON devices.id = deliveries.device_id
      JOIN game_memberships AS members ON members.game_id = deliveries.game_id AND members.account_id = devices.account_id
      WHERE deliveries.game_id = ? AND deliveries.game_version > ? ORDER BY deliveries.game_version`)
      .bind(gameId, afterVersion).all()).results;

    // White's queen plans to recapture on d4 while White's own pawn still occupies d4.
    let game = await create();
    game = await play(game, white, "d2", "d4");
    game = await play(game, black, "e7", "e5");
    game = await play(game, white, "a2", "a3");
    const beforeRecapture = game;
    assert.equal(new Chess(game.fen).get("d4").color, "w");
    const planned = queuePayload(game, 0, { from: "d1", to: "d4" });
    assert.equal((await put(game, outsider, planned)).status, 404);
    assert.equal((await request(runtime, `/api/games/${game.id}/premove`, { anonymous: true, method: "PUT", body: JSON.stringify(planned) })).status, 401);
    assert.equal((await put(game, black, queuePayload(game, 0, { from: "g8", to: "f6" }))).status, 409, "moving player cannot queue");
    assert.equal((await put(game, white, queuePayload(game, 0, { from: "e5", to: "e4" }))).status, 422, "cannot select opponent's piece");
    let queued = (await ok(await put(game, white, planned))).game;
    assert.equal(queued.version, game.version);
    assert.equal(queued.updatedAt, game.updatedAt, "queueing cannot extend the opponent's deadline");
    assert.equal(queued.deadlineAt, game.deadlineAt);
    assert.deepEqual(queued.premove, { revision: 1, status: "queued", move: planned.move });
    assert.equal((await ok(await put(game, white, planned))).game.premove.revision, 1, "queue replay is idempotent");
    const opponentView = await own(game, black);
    assert.deepEqual(opponentView.premove, { revision: 0, status: "none", move: null });
    assert.equal(Object.hasOwn(opponentView, "white_premove_json"), false);
    assert.equal((await call(`/api/games/${game.id}?sinceVersion=${game.version}&premoveRevision=0`, black)).status, 204, "opponent cannot observe private queue revisions");
    assert.equal((await call(`/api/games/${game.id}?sinceVersion=${game.version}&premoveRevision=0`, white)).status, 200);
    assert.equal((await call(`/api/games/${game.id}?sinceVersion=${game.version}&premoveRevision=1`, white)).status, 204);

    const capturePayload = movePayload(game, "e5", "d4");
    // White makes no request after this point until the two plies and push are committed.
    game = (await ok(await call(`/api/games/${game.id}/moves`, black, "POST", capturePayload))).game;
    assert.equal(game.version, beforeRecapture.version + 2);
    assert.equal(game.plyCount, beforeRecapture.plyCount + 2);
    assert.equal(game.turn, "b");
    assert.deepEqual(game.moves.slice(-2).map(({ color, from, to }) => ({ color, from, to })), [
      { color: "b", from: "e5", to: "d4" }, { color: "w", from: "d1", to: "d4" },
    ]);
    assert.equal(new Chess(game.fen).get("d4").type, "q");
    assert.equal(game.moves.at(-2).fenAfter, game.moves.at(-1).fenBefore);
    assert.equal(game.moves.at(-2).createdAt, game.moves.at(-1).createdAt, "premove does not charge thinking time");
    assert.deepEqual((await deliveries(game.id, beforeRecapture.version)).map(({ game_version, target_color }) => ({ game_version, target_color })), [
      { game_version: game.version, target_color: "b" },
    ], "only the final turn is notified");
    assert.equal(await waitFor(async () => (await deliveries(game.id, beforeRecapture.version))[0]?.status === "sent", 5_000), true);
    const storedQueue = JSON.parse((await db.prepare("SELECT white_premove_json FROM games WHERE id = ?").bind(game.id).first()).white_premove_json);
    assert.equal(storedQueue.status, "played"); assert.equal(storedQueue.revision, 2); assert.equal(storedQueue.move, null);
    const replay = (await ok(await call(`/api/games/${game.id}/moves`, black, "POST", capturePayload))).game;
    assert.equal(replay.version, game.version); assert.equal(replay.moves.length, game.moves.length);
    assert.equal((await deliveries(game.id, beforeRecapture.version)).length, 1);

    // Cancellation retains a revision tombstone; stale retries cannot resurrect old intent.
    game = await play(await create(), white, "e2", "e4");
    const q1 = queuePayload(game, 0, { from: "g1", to: "f3" });
    await ok(await put(game, white, q1));
    const cancel = queuePayload(game, 1, null);
    assert.equal((await ok(await put(game, white, cancel))).game.premove.revision, 2);
    assert.equal((await put(game, white, q1)).status, 409);
    assert.equal((await own(game, white)).premove.status, "cancelled");
    const q2 = queuePayload(game, 2, { from: "b1", to: "c3" });
    await ok(await put(game, white, q2));
    assert.equal((await put(game, white, cancel)).status, 409, "old cancellation cannot erase replacement");
    assert.equal((await ok(await put(game, white, q2))).game.premove.revision, 3);
    assert.equal((await put(game, white, { ...q2, move: q1.move })).status, 409, "request id cannot change its payload");
    game = await play(game, black, "e7", "e5");
    assert.equal(new Chess(game.fen).get("c3").type, "n");
    assert.equal(new Chess(game.fen).get("g1").type, "n");
    assert.equal((await own(game, white)).premove.status, "played");
    const usedVersion = game.version;
    game = await play(game, black, "d7", "d5");
    assert.equal(game.version, usedVersion + 1, "intent executes at most once");

    // A destination that remains occupied by our own piece invalidates the intent.
    game = await play(await create(), white, "e2", "e4");
    await ok(await put(game, white, queuePayload(game, 0, { from: "a1", to: "a2" })));
    const invalidAt = game.version;
    game = await play(game, black, "e7", "e5");
    assert.equal(game.version, invalidAt + 1); assert.equal(game.turn, "w");
    assert.deepEqual((await own(game, white)).premove, { revision: 2, status: "invalid", move: null });
    assert.deepEqual((await deliveries(game.id, invalidAt)).map(({ game_version, target_color }) => ({ game_version, target_color })), [
      { game_version: game.version, target_color: "w" },
    ]);

    // Existing fixture technique: custom initial FEN, then normal authenticated join/moves.
    game = await create({ fen: "7k/P7/8/8/8/8/8/7K b - - 0 1" });
    await ok(await put(game, white, queuePayload(game, 0, { from: "a7", to: "a8", promotion: "r" })));
    const promotionAt = game.version;
    game = await play(game, black, "h8", "g8");
    assert.equal(game.version, promotionAt + 2);
    assert.equal(game.moves.at(-1).promotion, "r");
    assert.deepEqual(new Chess(game.fen).get("a8"), { type: "r", color: "w" });

    // Execution checks current seat ownership, not merely a stored queued account ID.
    game = await play(await create(), white, "e2", "e4");
    await ok(await put(game, white, queuePayload(game, 0, { from: "g1", to: "f3" })));
    const membership = await db.prepare("SELECT account_id FROM game_memberships WHERE game_id = ? AND color = 'b'").bind(game.id).first();
    const stored = JSON.parse((await db.prepare("SELECT white_premove_json FROM games WHERE id = ?").bind(game.id).first()).white_premove_json);
    await db.prepare("UPDATE games SET white_premove_json = ? WHERE id = ?")
      .bind(JSON.stringify({ ...stored, accountId: membership.account_id }), game.id).run();
    const ownershipAt = game.version;
    game = await play(game, black, "e7", "e5");
    assert.equal(game.version, ownershipAt + 1);
    assert.equal((await own(game, white)).premove.status, "invalid");

    const waiting = await create({ join: false });
    assert.equal((await put(waiting, white, queuePayload(waiting, 0, { from: "g1", to: "f3" }))).status, 409);
    const solo = await create({ mode: "solo" });
    assert.equal((await put(solo, white, queuePayload(solo, 0, { from: "g1", to: "f3" }))).status, 409);
    console.log("E2E passed: server-persistent premove recapture, private cursors, atomic offline execution, final-turn-only push, replay/cancel/replace, invalid drop, promotion and ownership guards");
  } finally { await runtime.dispose(); }
}
