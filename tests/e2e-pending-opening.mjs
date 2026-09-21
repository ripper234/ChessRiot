import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

export async function verifyPendingOpenings({ createRuntime, request, body, accountForLabel, usernameForAccount, secret, pushClientPublicKey }) {
  const runtime = createRuntime({ databaseName: "pending-openings-e2e", outboundService: async () => new Response(null, { status: 201 }) });
  try {
    const white = accountForLabel("Pending White");
    const black = accountForLabel("Pending Black");
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
    const friend = await ok(await call("/api/me/friend-requests", white, "POST", { username: usernameForAccount(black) }), 201);
    await ok(await call(`/api/me/friend-requests/${friend.requestId}`, black, "PATCH", { action: "accept" }));
    const db = await runtime.getD1Database("DB");
    async function create(direct, days = 3) {
      const inviteToken = secret();
      const data = await ok(await call("/api/games", white, "POST", {
        mode: "multiplayer", variantId: "standard", turnPaceDays: days,
        playerToken: secret(), inviteToken, requestId: randomUUID(),
        ...(direct ? { opponentUsername: usernameForAccount(black) } : {}),
      }), 201);
      const joinToken = secret();
      const acceptId = randomUUID();
      return { game: data.game, inviteToken,
        accept: () => direct
          ? call(`/api/games/${data.game.id}/challenge`, black, "PATCH", { action: "accept", requestId: acceptId })
          : call(`/api/invitations/${inviteToken}/join`, black, "POST", { playerToken: joinToken }) };
    }
    const move = (id, who, version, from = "e2", to = "e4", requestId = randomUUID()) =>
      call(`/api/games/${id}/moves`, who, "POST", { from, to, expectedVersion: version, requestId });
    const rows = async (id) => (await db.prepare("SELECT deliveries.game_version, members.color AS target_color FROM push_turn_deliveries AS deliveries JOIN push_devices AS devices ON devices.id = deliveries.device_id JOIN game_memberships AS members ON members.account_id = devices.account_id AND members.game_id = deliveries.game_id WHERE deliveries.game_id = ? ORDER BY deliveries.game_version").bind(id).all()).results;

    for (const direct of [false, true]) {
      const test = await create(direct, direct ? 5 : 3);
      const id = test.game.id;
      if (direct) {
        const item = (await ok(await call("/api/me/activity", black))).items.find((item) => item.gameId === id && item.kind === "challenge");
        assert.equal(item.openingPlayed, false); assert.equal(item.turnPaceDays, 5);
      }
      const old = new Date(Date.now() - 7 * 86_400_000).toISOString();
      await db.prepare("UPDATE games SET created_at = ?, updated_at = ? WHERE id = ?").bind(old, old, id).run();
      const waiting = (await ok(await call(`/api/games/${id}`, white))).game;
      assert.equal(waiting.status, "waiting"); assert.equal(waiting.deadlineAt, null);
      assert.deepEqual(waiting.elapsedMs, { w: 0, b: 0 });
      assert.equal((await move(id, black, 0, "e7", "e5")).status, direct ? 409 : 404);
      assert.equal((await move(id, white, 0, "e2", "e5")).status, 422);
      const moveId = randomUUID();
      const opening = (await ok(await move(id, white, 0, "e2", "e4", moveId))).game;
      assert.equal(opening.status, "waiting"); assert.equal(opening.version, 1);
      assert.equal(opening.turn, "b"); assert.equal(opening.plyCount, 1);
      assert.equal(opening.deadlineAt, null); assert.equal(opening.turnStartedAt, null);
      assert.deepEqual(opening.elapsedMs, { w: 0, b: 0 });
      assert.equal((await ok(await move(id, white, 0, "e2", "e4", moveId))).game.version, 1);
      assert.equal((await move(id, white, 1, "d2", "d4", moveId)).status, 409);
      assert.equal((await move(id, white, 1, "d2", "d4")).status, 409);
      assert.equal((await move(id, black, 1, "e7", "e5")).status, direct ? 409 : 404);
      assert.deepEqual(await rows(id), [], "no turn push before acceptance");
      assert.equal((await ok(await call(`/api/games/${id}`, white))).game.fen, opening.fen);
      if (!direct) assert.equal((await ok(await call(`/api/invitations/${test.inviteToken}`, black))).openingPlayed, true);
      if (direct) {
        const item = (await ok(await call("/api/me/activity", black))).items.find((item) => item.gameId === id && item.kind === "challenge");
        assert.equal(item.openingPlayed, true); assert.match(item.detail, /White has played the opening/);
        const dashboardGame = (await ok(await call("/api/me/games?view=watch&limit=8", black))).games.find((game) => game.id === id);
        assert.equal(dashboardGame.status, "waiting"); assert.equal(dashboardGame.turn, "b");
      }
      const joined = (await ok(await test.accept())).game;
      assert.equal(joined.status, "active"); assert.equal(joined.version, 2);
      assert.equal(joined.turn, "b"); assert.equal(joined.fen, opening.fen);
      assert.deepEqual(joined.moves, opening.moves);
      assert.equal(joined.elapsedMs.w, 0);
      assert.equal(Date.parse(joined.deadlineAt) - Date.parse(joined.updatedAt), (direct ? 5 : 3) * 86_400_000);
      assert.equal(joined.turnStartedAt, joined.updatedAt);
      assert.deepEqual(await rows(id), [{ game_version: 2, target_color: "b" }]);
      await ok(await test.accept());
      assert.deepEqual(await rows(id), [{ game_version: 2, target_color: "b" }]);
      const reply = (await ok(await move(id, black, 2, "e7", "e5"))).game;
      assert.equal(reply.version, 3); assert.equal(reply.turn, "w"); assert.equal(reply.plyCount, 2);
      assert.deepEqual(await rows(id), [{ game_version: 2, target_color: "b" }, { game_version: 3, target_color: "w" }]);

      const racing = await create(direct);
      const [played, accepted] = await Promise.all([move(racing.game.id, white, 0), racing.accept()]);
      await ok(accepted);
      let final = (await ok(await call(`/api/games/${racing.game.id}`, white))).game;
      if (played.status === 409) final = (await ok(await move(racing.game.id, white, final.version))).game;
      else await ok(played);
      assert.equal(final.status, "active"); assert.equal(final.plyCount, 1);
      assert.equal(final.version, 2); assert.equal(final.turn, "b");
      assert.equal((await call(`/api/games/${racing.game.id}?sinceVersion=1`, white)).status, 200);
      assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM moves WHERE game_id = ?").bind(racing.game.id).first()).count, 1);

      const cancelled = await create(direct);
      await ok(await move(cancelled.game.id, white, 0));
      const end = direct
        ? await call(`/api/games/${cancelled.game.id}/challenge`, black, "PATCH", { action: "decline", requestId: randomUUID() })
        : await call(`/api/games/${cancelled.game.id}/end`, white, "POST", { expectedVersion: 1, requestId: randomUUID() });
      const ended = (await ok(end)).game;
      assert.equal(ended.status, "completed"); assert.equal(ended.outcome.reason, "cancelled");
      assert.deepEqual(ended.elapsedMs, { w: 0, b: 0 });
      assert.equal((await cancelled.accept()).status, direct ? 409 : 410);
      assert.deepEqual(await rows(cancelled.game.id), []);
    }
    const legacy = await create(false);
    await db.prepare("UPDATE game_settings SET turn_pace_days = NULL WHERE game_id = ?").bind(legacy.game.id).run();
    assert.equal((await move(legacy.game.id, white, 0)).status, 409);
    const terminal = await create(false);
    const fen = "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1";
    await db.prepare("UPDATE games SET initial_fen = ?, current_fen = ? WHERE id = ?").bind(fen, fen, terminal.game.id).run();
    const rejected = await move(terminal.game.id, white, 0, "f7", "g7");
    assert.equal(rejected.status, 409); assert.equal((await body(rejected)).error.code, "opening_requires_acceptance");
    assert.equal((await ok(await call(`/api/games/${terminal.game.id}`, white))).game.plyCount, 0);
    assert.deepEqual(await rows(terminal.game.id), []);
    console.log("E2E passed: pending openings, both acceptance paths, races, exact turn notifications, full deadlines, replay, cancellation and decline");
  } finally { await runtime.dispose(); }
}
