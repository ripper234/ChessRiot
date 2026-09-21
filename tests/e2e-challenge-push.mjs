// Read-only audit proposal: root may copy this fixture into tests and wire it in.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

export async function verifyChallengePush({ createRuntime, request, body, accountForLabel, usernameForAccount, secret, pushClientPublicKey, waitFor }) {
  const sends = [];
  let nextProviderGate = null;
  const runtime = createRuntime({
    databaseName: "challenge-push-e2e",
    outboundService: async (outbound) => {
      const gate = nextProviderGate;
      nextProviderGate = null;
      sends.push({ endpoint: outbound.url, ttl: outbound.headers.get("ttl"), bytes: (await outbound.arrayBuffer()).byteLength });
      if (gate) { await gate; return new Response(null, { status: 503 }); }
      return new Response(null, { status: 201 });
    },
  });
  let releaseHeldProvider = () => {};
  try {
    const white = accountForLabel("Challenge Push White");
    const black = accountForLabel("Challenge Push Black");
    const outsider = accountForLabel("Challenge Push Other");
    const identity = (who) => ({ accountEmail: who.email, accountName: who.displayName });
    const call = (path, who, method = "GET", payload) => request(runtime, path, { ...identity(who), method, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const ok = async (response, status = 200) => { const data = await body(response); assert.equal(response.status, status, JSON.stringify(data)); return data; };
    // Establish friendship before either device exists, avoiding unrelated pushes.
    await ok(await call("/api/me/friends", black));
    const friendship = await ok(await call("/api/me/friend-requests", white, "POST", { username: usernameForAccount(black) }), 201);
    await ok(await call(`/api/me/friend-requests/${friendship.requestId}`, black, "PATCH", { action: "accept" }));
    const recipientEndpoint = `https://fcm.googleapis.com/fcm/send/${secret()}`;
    const creatorEndpoint = `https://fcm.googleapis.com/fcm/send/${secret()}`;
    const registerDevice = async (who, endpoint) => {
      await ok(await call("/api/me/push-devices", who, "PUT", {
        requestId: randomUUID(), expectedUsername: usernameForAccount(who),
        subscription: { endpoint, expirationTime: null,
          keys: { p256dh: pushClientPublicKey, auth: randomBytes(16).toString("base64url") } },
      }));
    };
    await registerDevice(white, creatorEndpoint);
    await registerDevice(black, recipientEndpoint);
    const db = await runtime.getD1Database("DB");
    const rows = async (gameId) => (await db.prepare(`SELECT kind, game_id, friend_request_id, status, attempt_count
      FROM push_account_deliveries WHERE game_id = ?`).bind(gameId).all()).results;
    const create = async (overrides = {}) => {
      const payload = { mode: "multiplayer", variantId: "standard", turnPaceDays: 3,
        playerToken: secret(), inviteToken: secret(), requestId: randomUUID(),
        opponentUsername: usernameForAccount(black), ...overrides };
      const data = await ok(await call("/api/games", white, "POST", payload), 201);
      return { payload, game: data.game };
    };

    const first = await create();
    // Only D1 reads from now until delivery: no recipient HTTP request may wake it.
    assert.equal(await waitFor(async () => (await rows(first.game.id))[0]?.status === "sent", 5_000), true);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].endpoint, recipientEndpoint);
    assert.equal(sends[0].ttl, "86400");
    assert.ok(sends[0].bytes > 100, "traverses encrypted Web Push");
    const initialRows = await rows(first.game.id);
    assert.equal(initialRows.length, 1);
    assert.equal(initialRows[0].kind, "challenge");
    assert.equal(initialRows[0].friend_request_id, null);
    await ok(await call("/api/games", white, "POST", first.payload));
    assert.deepEqual(await rows(first.game.id), initialRows);
    assert.equal(sends.length, 1, "create replay does not duplicate the invite");

    for (const scenario of ["disabled", "reassigned", "declined", "opening"]) {
      await registerDevice(black, recipientEndpoint); // fresh auth also recovers disabled keys
      nextProviderGate = new Promise((resolve) => { releaseHeldProvider = resolve; });
      const before = sends.length;
      const created = await create();
      assert.equal(await waitFor(() => sends.length === before + 1, 3_000), true);
      // The first provider call is held. Any concurrent drains respect its lease.
      if (scenario === "disabled") {
        // Preserve the audit row, as a provider-stale/expired-device disable does.
        // The explicit DELETE API removes the device and cascades its deliveries.
        await db.prepare("UPDATE push_devices SET disabled_at = ? WHERE endpoint = ?")
          .bind(new Date().toISOString(), recipientEndpoint).run();
      } else if (scenario === "reassigned") {
        await registerDevice(outsider, recipientEndpoint);
      } else if (scenario === "declined") {
        await ok(await call(`/api/games/${created.game.id}/challenge`, black, "PATCH", { action: "decline", requestId: randomUUID() }));
      } else {
        const opened = await ok(await call(`/api/games/${created.game.id}/moves`, white, "POST", {
          from: "e2", to: "e4", expectedVersion: 0, requestId: randomUUID(),
        }));
        assert.equal(opened.game.status, "waiting");
        assert.equal(opened.game.version, 1);
      }
      releaseHeldProvider();
      releaseHeldProvider = () => {};
      const expected = scenario === "disabled" ? "dead" : scenario === "opening" ? "sent" : "superseded";
      assert.equal(await waitFor(async () => (await rows(created.game.id))[0]?.status === expected, 7_000), true, scenario);
      assert.equal(sends.length, before + (scenario === "opening" ? 2 : 1), scenario);
      assert.ok(sends.slice(before).every((send) => send.endpoint === recipientEndpoint));
      if (scenario === "opening") assert.equal((await rows(created.game.id))[0].attempt_count, 2);
    }
    assert.ok(sends.every((send) => send.endpoint !== creatorEndpoint));
    const link = await create({ opponentUsername: undefined });
    assert.equal((await rows(link.game.id)).length, 0, "link invitations have no selected recipient");
    console.log("E2E passed: challenge creation without recipient traffic, replay, stale ownership/permission/invitation suppression, and pending opening retry");
  } finally {
    releaseHeldProvider();
    await runtime.dispose();
  }
}
