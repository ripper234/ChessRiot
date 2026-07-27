import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
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
const accountIdSecret = "local-account-id-secret-for-e2e-tests";
const vapidKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const vapidPrivateJwk = vapidKeys.privateKey.export({ format: "jwk" });
const vapidPublicJwk = vapidKeys.publicKey.export({ format: "jwk" });
const vapidPublicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(vapidPublicJwk.x, "base64url"),
  Buffer.from(vapidPublicJwk.y, "base64url"),
]).toString("base64url");
const pushClientKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pushClientPublicJwk = pushClientKeys.publicKey.export({ format: "jwk" });
const pushClientPublicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pushClientPublicJwk.x, "base64url"),
  Buffer.from(pushClientPublicJwk.y, "base64url"),
]).toString("base64url");
const outboundPushRequests = [];
const accountBySeatToken = new Map();
const guestIdentityByLabel = new Map();

function guestIdentityForLabel(label) {
  const key = String(label || "E2E Player");
  const existing = guestIdentityByLabel.get(key);
  if (existing) return existing;
  const created = secret();
  guestIdentityByLabel.set(key, created);
  return created;
}

function accountForLabel(label) {
  const clean = String(label || "Player").normalize("NFKC").trim() || "Player";
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
  return {
    displayName: clean,
    email: `${slug}@players.chessriot.test`,
  };
}

function accountForUnknownSeat(token) {
  const id = createHmac("sha256", accountIdSecret)
    .update(token)
    .digest("hex")
    .slice(0, 18);
  return { displayName: "Other player", email: `seat-${id}@players.chessriot.test` };
}

function signedAccountHeaders(account) {
  const email = account.email.normalize("NFKC").trim().toLowerCase();
  return {
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(account.displayName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

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
      ACCOUNT_ID_SECRET: accountIdSecret,
      VAPID_PUBLIC_KEY: vapidPublicKey,
      VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivateJwk),
      VAPID_SUBJECT: "https://chessriot.test",
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "fcm.googleapis.com") {
        return new Response(null, { status: 502 });
      }
      outboundPushRequests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        encoding: request.headers.get("content-encoding"),
        ttl: request.headers.get("ttl"),
        body: Buffer.from(await request.arrayBuffer()).toString("utf8"),
      });
      return new Response(null, { status: 201 });
    },
    defaultPersistRoot: persistRoot,
    d1Persist: true,
  });
}

async function request(runtime, path, init = {}) {
  const {
    anonymous = false,
    accountEmail,
    accountName,
    ...requestInit
  } = init;
  const headers = new Headers(requestInit.headers);
  if (!headers.has("origin")) headers.set("origin", origin);
  if (requestInit.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  let parsedBody = null;
  if (
    typeof requestInit.body === "string"
    && headers.get("content-type")?.includes("application/json")
  ) {
    try {
      parsedBody = JSON.parse(requestInit.body);
      if (parsedBody?.playerToken && !parsedBody.guestToken) {
        parsedBody.guestToken = guestIdentityForLabel(
          accountEmail || parsedBody.displayName || accountName,
        );
        requestInit.body = JSON.stringify(parsedBody);
      }
    } catch {
      parsedBody = null;
    }
  }

  if (!anonymous) {
    const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    let account = accountEmail
      ? { email: accountEmail, displayName: accountName || accountEmail.split("@")[0] }
      : bearer
        ? accountBySeatToken.get(bearer) || accountForUnknownSeat(bearer)
        : parsedBody?.displayName
          ? accountForLabel(parsedBody.displayName)
          : accountForLabel(accountName || "E2E Player");
    if (parsedBody?.playerToken) {
      account = parsedBody.displayName
        ? accountForLabel(parsedBody.displayName)
        : account;
      accountBySeatToken.set(parsedBody.playerToken, account);
    }
    for (const [name, value] of Object.entries(signedAccountHeaders(account))) {
      if (!headers.has(name)) headers.set(name, value);
    }
  }
  return runtime.dispatchFetch(`${origin}${path}`, { ...requestInit, headers });
}

async function body(response) {
  return response.status === 204 ? null : response.json();
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return true;
}

let runtime = createRuntime();
try {
  const anonymousCreate = await request(runtime, "/api/games", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(anonymousCreate.status, 400);
  assert.equal((await body(anonymousCreate)).error.code, "invalid_request");
  assert.equal((await request(runtime, "/api/me/games", { anonymous: true })).status, 401);

  const opaqueSameOriginCreate = await request(runtime, "/api/games", {
    anonymous: true,
    method: "POST",
    headers: {
      origin: "null",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
    body: JSON.stringify({}),
  });
  assert.equal(opaqueSameOriginCreate.status, 400);
  assert.equal((await body(opaqueSameOriginCreate)).error.code, "invalid_request");
  const opaqueCrossSiteCreate = await request(runtime, "/api/games", {
    anonymous: true,
    method: "POST",
    headers: {
      origin: "null",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
    },
    body: JSON.stringify({}),
  });
  assert.equal(opaqueCrossSiteCreate.status, 403);
  assert.equal((await body(opaqueCrossSiteCreate)).error.code, "wrong_origin");

  const retiredCaptchaRoute = await request(runtime, "/api/auth/captcha", {
    method: "POST",
    body: new URLSearchParams(),
  });
  assert.equal(retiredCaptchaRoute.status, 404);

  const invalidInviteDatabase = await runtime.getD1Database("DB");
  const rateRowsBeforeInvalidInvite = await invalidInviteDatabase
    .prepare("SELECT COUNT(*) AS count FROM rate_limit_windows")
    .first();
  const accountsBeforeInvalidInvite = await invalidInviteDatabase
    .prepare("SELECT COUNT(*) AS count FROM accounts")
    .first();
  const nonexistentInvite = secret();
  assert.equal((await request(runtime, `/api/invitations/${nonexistentInvite}`, {
    anonymous: true,
  })).status, 404);
  assert.equal((await request(runtime, `/api/invitations/${nonexistentInvite}/join`, {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      displayName: "No Game",
      guestToken: secret(),
      playerToken: secret(),
    }),
  })).status, 404);
  const rateRowsAfterInvalidInvite = await invalidInviteDatabase
    .prepare("SELECT COUNT(*) AS count FROM rate_limit_windows")
    .first();
  const accountsAfterInvalidInvite = await invalidInviteDatabase
    .prepare("SELECT COUNT(*) AS count FROM accounts")
    .first();
  assert.equal(rateRowsAfterInvalidInvite.count, rateRowsBeforeInvalidInvite.count);
  assert.equal(accountsAfterInvalidInvite.count, accountsBeforeInvalidInvite.count);

  const guestWhiteToken = secret();
  const guestBlackToken = secret();
  const guestWhiteIdentity = secret();
  const guestBlackIdentity = secret();
  const guestInviteToken = secret();
  const guestCreateRequestId = randomUUID();
  const guestCreateResponse = await request(runtime, "/api/games", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      displayName: "Guest White",
      guestToken: guestWhiteIdentity,
      mode: "multiplayer",
      playerToken: guestWhiteToken,
      inviteToken: guestInviteToken,
      requestId: guestCreateRequestId,
    }),
  });
  assert.equal(guestCreateResponse.status, 201);
  const guestCreated = await body(guestCreateResponse);
  const guestGameId = guestCreated.game.id;

  const guestCreateRetryWithAmbientIdentity = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: "ambient-account@players.chessriot.test",
    body: JSON.stringify({
      displayName: "Guest White",
      guestToken: guestWhiteIdentity,
      mode: "multiplayer",
      playerToken: guestWhiteToken,
      inviteToken: guestInviteToken,
      requestId: guestCreateRequestId,
    }),
  });
  assert.equal(guestCreateRetryWithAmbientIdentity.status, 200);
  assert.equal((await body(guestCreateRetryWithAmbientIdentity)).game.id, guestGameId);

  const guestInviteResponse = await request(
    runtime,
    `/api/invitations/${guestInviteToken}`,
    { anonymous: true },
  );
  assert.equal(guestInviteResponse.status, 200);
  assert.equal((await body(guestInviteResponse)).creatorName, "Guest White");

  const sameGuestJoinResponse = await request(
    runtime,
    `/api/invitations/${guestInviteToken}/join`,
    {
      anonymous: true,
      method: "POST",
      body: JSON.stringify({
        displayName: "Guest White Again",
        guestToken: guestWhiteIdentity,
        playerToken: guestBlackToken,
      }),
    },
  );
  assert.equal(sameGuestJoinResponse.status, 409);
  assert.equal((await body(sameGuestJoinResponse)).error.code, "same_player");

  const guestJoinResponse = await request(
    runtime,
    `/api/invitations/${guestInviteToken}/join`,
    {
      anonymous: true,
      method: "POST",
      body: JSON.stringify({
        displayName: "Guest Black",
        guestToken: guestBlackIdentity,
        playerToken: guestBlackToken,
      }),
    },
  );
  assert.equal(guestJoinResponse.status, 200);

  const pushConfig = await body(await request(runtime, "/api/push/config", {
    anonymous: true,
  }));
  assert.deepEqual(pushConfig, { enabled: true, publicKey: vapidPublicKey });
  const guestPushEndpoint = `https://fcm.googleapis.com/fcm/send/${secret()}`;
  const guestPushEndpointHash = createHash("sha256")
    .update(guestPushEndpoint)
    .digest("hex");
  const guestPushSubscription = {
    endpoint: guestPushEndpoint,
    expirationTime: null,
    keys: {
      p256dh: pushClientPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  const enableGuestPush = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      method: "PUT",
      headers: { authorization: `Bearer ${guestBlackToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: guestPushSubscription,
      }),
    },
  );
  assert.equal(enableGuestPush.status, 200);
  assert.deepEqual(await body(enableGuestPush), { enabled: true });
  assert.deepEqual(await body(await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      headers: {
        authorization: `Bearer ${guestBlackToken}`,
        "x-push-endpoint-hash": guestPushEndpointHash,
      },
    },
  )), { available: true, enabled: true });
  assert.deepEqual(await body(await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      headers: {
        authorization: `Bearer ${guestWhiteToken}`,
        "x-push-endpoint-hash": guestPushEndpointHash,
      },
    },
  )), { available: true, enabled: false });
  assert.equal((await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      method: "PUT",
      headers: { authorization: `Bearer ${guestBlackToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: {
          ...guestPushSubscription,
          endpoint: "https://example.com/forged-push-endpoint",
        },
      }),
    },
  )).status, 400);
  const pushDatabase = await runtime.getD1Database("DB");
  const storedGuestPush = await pushDatabase
    .prepare(`SELECT game_id, color, endpoint_hash
      FROM push_subscriptions LIMIT 1`)
    .first();
  assert.deepEqual(storedGuestPush, {
    game_id: guestGameId,
    color: "b",
    endpoint_hash: guestPushEndpointHash,
  });
  assert.equal(
    (await pushDatabase
      .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
      .first()).count,
    1,
  );
  const enableSameDeviceForWhite = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      method: "PUT",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: guestPushSubscription,
      }),
    },
  );
  assert.equal(enableSameDeviceForWhite.status, 200);
  assert.equal(
    (await pushDatabase
      .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
      .first()).count,
    2,
  );
  const disableWhitePush = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      method: "DELETE",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        endpoint: guestPushEndpoint,
      }),
    },
  );
  assert.equal(disableWhitePush.status, 200);
  assert.deepEqual(await body(disableWhitePush), { enabled: false });
  assert.equal(
    (await pushDatabase
      .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
      .first()).count,
    1,
  );
  assert.deepEqual(await body(await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      anonymous: true,
      headers: {
        authorization: `Bearer ${guestWhiteToken}`,
        "x-push-endpoint-hash": guestPushEndpointHash,
      },
    },
  )), { available: true, enabled: false });
  assert.deepEqual(await body(await request(
    runtime,
    `/api/games/${guest