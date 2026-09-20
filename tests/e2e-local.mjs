import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import { Chess } from "chess.js";
import { caseFold } from "unicode-case-folding";

const origin = "http://chessriot.test";
const controlOrigin = "https://control.chessriot.test";
const devOrigin = "https://dev.chessriot.gg";
const secret = () => randomBytes(32).toString("base64url");
const requestIdForColor = (color) => {
  const id = randomUUID();
  return id.slice(0, -1) + (color === "w" ? "0" : "1");
};
const opsSecret = "local-ops-read-secret-for-e2e-tests";
const accountIdSecret = "local-account-id-secret-for-e2e-tests";
const googleSessionSecret = "local-google-session-secret-for-e2e-tests";
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
const forcedPushStatuses = [];
const forcedPushResponders = [];
const accountBySeatToken = new Map();
const guestIdentityByLabel = new Map();
const preparedAccountsByRuntime = new WeakMap();

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

function usernameForAccount(account) {
  const base = String(account.displayName || "Player")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+$/g, "")
    .slice(0, 13) || "Player";
  const suffix = createHash("sha256").update(account.email).digest("hex").slice(0, 5);
  return `${/^[A-Za-z]/.test(base) ? base : `P${base}`}_${suffix}`.slice(0, 20);
}

async function prepareRegisteredAccount(runtime, account) {
  let prepared = preparedAccountsByRuntime.get(runtime);
  if (!prepared) {
    prepared = new Set();
    preparedAccountsByRuntime.set(runtime, prepared);
  }
  const email = account.email.normalize("NFKC").trim().toLowerCase();
  if (prepared.has(email)) return;
  const headers = new Headers({ origin });
  for (const [name, value] of Object.entries(signedAccountHeaders(account))) {
    headers.set(name, value);
  }
  const session = signedGoogleSession(email, account.displayName);
  headers.set("cookie", session.cookie);
  const response = await runtime.dispatchFetch(`${origin}/api/auth/session`, { headers });
  assert.equal(response.status, 200);
  const username = usernameForAccount(account);
  await (await runtime.getD1Database("DB"))
    .prepare(`UPDATE accounts SET username = ?, username_canonical = ?, username_set_at = ? WHERE id = ?`)
    .bind(
      username,
      caseFold(username.normalize("NFKC")).normalize("NFKC"),
      new Date().toISOString(),
      session.accountId,
    )
    .run();
  prepared.add(email);
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
const runtimeConfig = JSON.parse(await readFile(resolve(".openai/runtime.json"), "utf8"));

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

async function defaultOutboundService(request) {
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
    urgency: request.headers.get("urgency"),
    topic: request.headers.get("topic"),
    body: Buffer.from(await request.arrayBuffer()).toString("utf8"),
  });
  const responder = forcedPushResponders.shift();
  if (responder) return await responder();
  return new Response(null, { status: forcedPushStatuses.shift() ?? 201 });
}

function createRuntime({
  databaseName = "chessriot-e2e",
  bucketName = `${databaseName}-bucket`,
  extraBindings = {},
  outboundService = defaultOutboundService,
} = {}) {
  return new Miniflare({
    modules: modulePaths.map((path) => ({ type: "ESModule", path })),
    modulesRoot: serverRoot,
    compatibilityDate: runtimeConfig.cloudflareCompatibilityDate,
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: databaseName },
    r2Buckets: { BUCKET: bucketName },
    bindings: {
      CHESSRIOT_ENV: "test",
      CONTROL_ORIGIN: controlOrigin,
      OBSERVABILITY_HASH_SECRET: "local-observability-hash-secret-for-e2e",
      OPS_READ_SECRET: opsSecret,
      ACCOUNT_ID_SECRET: accountIdSecret,
      GOOGLE_AUTH_SESSION_SECRET_DEV: googleSessionSecret,
      VAPID_PUBLIC_KEY: vapidPublicKey,
      VAPID_PRIVATE_JWK: JSON.stringify(vapidPrivateJwk),
      VAPID_SUBJECT: "https://chessriot.test",
      ...extraBindings,
    },
    outboundService,
    resourcePersistencePath: persistRoot,
  });
}

function signedGoogleSession(subject, displayName, {
  version = 2,
  authenticatedAt,
  issuedAt,
  expiresAt,
} = {}) {
  const accountId = "google_" + createHmac("sha256", accountIdSecret)
    .update(`google-sub:v1:${subject}`)
    .digest("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sessionIssuedAt = issuedAt ?? now;
  const sessionPayload = {
    v: version,
    kind: "google-session",
    ...(version === 2
      ? { authenticatedAt: authenticatedAt ?? sessionIssuedAt }
      : {}),
    iat: sessionIssuedAt,
    exp: expiresAt
      ?? sessionIssuedAt + (version === 1 ? 30 : 365) * 24 * 60 * 60,
    accountId,
    displayName,
  };
  const payload = Buffer.from(JSON.stringify(sessionPayload)).toString("base64url");
  const signature = createHmac("sha256", googleSessionSecret)
    .update(payload)
    .digest("base64url");
  return {
    accountId,
    cookie: `__Host-chessriot-google-session=${payload}.${signature}`,
  };
}

function googleSessionValuesFromResponse(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return [...setCookie.matchAll(/__Host-chessriot-google-session=([^;,]*)/g)]
    .map((match) => match[1]);
}

function googleSessionPayload(value) {
  return JSON.parse(Buffer.from(value.split(".", 1)[0], "base64url").toString("utf8"));
}

async function verifyGoogleSessionHardening() {
  const sessionRuntime = createRuntime({
    databaseName: "chessriot-google-session-hardening-e2e",
  });
  const day = 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1_000);
  const authenticatedAt = now - 2 * day;
  const refreshEligible = signedGoogleSession(
    "sliding-session-player",
    "Sliding Session Player",
    { authenticatedAt, issuedAt: now - day - 60 },
  );
  try {
    const beforeRenewal = Math.floor(Date.now() / 1_000);
    const activity = await sessionRuntime.dispatchFetch(`${origin}/api/auth/session`, {
      headers: { cookie: refreshEligible.cookie, origin },
    });
    const afterRenewal = Math.floor(Date.now() / 1_000);
    assert.equal(activity.status, 200);
    const activitySessionValues = googleSessionValuesFromResponse(activity);
    assert.equal(activitySessionValues.length, 1);
    const renewedPayload = googleSessionPayload(activitySessionValues[0]);
    assert.equal(renewedPayload.v, 2);
    assert.equal(renewedPayload.kind, "google-session");
    assert.equal(renewedPayload.accountId, refreshEligible.accountId);
    assert.equal(renewedPayload.authenticatedAt, authenticatedAt);
    assert.ok(renewedPayload.iat >= beforeRenewal);
    assert.ok(renewedPayload.iat <= afterRenewal);
    assert.equal(renewedPayload.exp - renewedPayload.iat, 365 * day);
    assert.match(activity.headers.get("set-cookie") ?? "", /Max-Age=31536000/);
    const renewedCookie = `__Host-chessriot-google-session=${activitySessionValues[0]}`;

    const deleteAfterRenewal = await sessionRuntime.dispatchFetch(`${origin}/api/me/account`, {
      method: "DELETE",
      headers: {
        cookie: renewedCookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "Sliding_Player" }),
    });
    assert.equal(deleteAfterRenewal.status, 403);
    assert.equal((await deleteAfterRenewal.json()).error.code, "recent_auth_required");
    assert.deepEqual(googleSessionValuesFromResponse(deleteAfterRenewal), []);

    const signout = await sessionRuntime.dispatchFetch(`${origin}/api/auth/signout`, {
      method: "POST",
      headers: { cookie: refreshEligible.cookie, origin },
    });
    assert.equal(signout.status, 200);
    assert.deepEqual(googleSessionValuesFromResponse(signout), [""]);
    assert.match(
      signout.headers.get("set-cookie") ?? "",
      /__Host-chessriot-google-session=;[^,]*Max-Age=0/,
    );

    const legacyIssuedAt = now - 60;
    const legacy = signedGoogleSession("legacy-session-player", "Legacy Session Player", {
      version: 1,
      issuedAt: legacyIssuedAt,
    });
    const legacyActivity = await sessionRuntime.dispatchFetch(`${origin}/api/auth/session`, {
      headers: { cookie: legacy.cookie, origin },
    });
    assert.equal(legacyActivity.status, 200);
    const legacySessionValues = googleSessionValuesFromResponse(legacyActivity);
    assert.equal(legacySessionValues.length, 1);
    const upgradedPayload = googleSessionPayload(legacySessionValues[0]);
    assert.equal(upgradedPayload.v, 2);
    assert.equal(upgradedPayload.accountId, legacy.accountId);
    assert.equal(upgradedPayload.authenticatedAt, legacyIssuedAt);
    assert.ok(upgradedPayload.iat >= beforeRenewal);
    assert.equal(upgradedPayload.exp - upgradedPayload.iat, 365 * day);
  } finally {
    await sessionRuntime.dispose();
  }
}

async function verifyGoogleAccountFlow() {
  const signedRs256Jwt = (claims, privateKey, keyId) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }))
      .toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const value = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(value).sign(privateKey)
      .toString("base64url");
    return `${value}.${signature}`;
  };
  const flowFromStart = (response) => {
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieMatch = /(__Host-chessriot-google-flow=([^;,]+))/.exec(setCookie);
    assert.ok(cookieMatch);
    return {
      cookie: cookieMatch[1],
      payload: JSON.parse(
        Buffer.from(cookieMatch[2].split(".")[0], "base64url").toString("utf8"),
      ),
    };
  };
  const googleClientId = "dev-client.apps.googleusercontent.com";
  const googleKeyId = "chessriot-google-e2e-key";
  const googleKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const googlePublicJwk = {
    ...googleKeys.publicKey.export({ format: "jwk" }),
    alg: "RS256",
    kid: googleKeyId,
    use: "sig",
  };
  let googleIdToken = null;
  let openAiRequests = 0;
  const googleOutboundService = async (request) => {
    const url = new URL(request.url);
    if (url.href === "https://api.openai.com/v1/responses") {
      openAiRequests += 1;
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), "Bearer dev-openai-key");
      const payload = await request.json();
      assert.deepEqual(payload, {
        model: "gpt-5.6-luna",
        input: "Reply with exactly CHESSRIOT_OK",
        reasoning: { effort: "none" },
        max_output_tokens: 16,
        store: false,
      });
      return Response.json(
        { output: [{ content: [{ type: "output_text", text: "CHESSRIOT_OK" }] }] },
        { headers: { "x-request-id": "req_chessriot_smoke" } },
      );
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(await request.text());
      assert.equal(request.method, "POST");
      assert.equal(form.get("client_id"), googleClientId);
      assert.equal(form.get("client_secret"), "dev-client-secret");
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("redirect_uri"), `${devOrigin}/api/auth/google/callback`);
      assert.match(form.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43}$/);
      if (form.get("code") === "failed-code" || !googleIdToken) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: "unused-access-token",
        expires_in: 3_600,
        id_token: googleIdToken,
        token_type: "Bearer",
      });
    }
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json(
        { keys: [googlePublicJwk] },
        { headers: { "cache-control": "public, max-age=300" } },
      );
    }
    return defaultOutboundService(request);
  };
  const googleRuntime = createRuntime({
    databaseName: "chessriot-google-e2e",
    extraBindings: {
      CHESSRIOT_ENV: "development",
      APP_ORIGIN: devOrigin,
      GOOGLE_CLIENT_ID_DEV: googleClientId,
      GOOGLE_CLIENT_SECRET_DEV: "dev-client-secret",
      GOOGLE_AUTH_SESSION_SECRET_DEV: googleSessionSecret,
      OPENAI_API_KEY_DEV: "dev-openai-key",
    },
    outboundService: googleOutboundService,
  });
  const dispatch = (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) headers.set("origin", devOrigin);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return googleRuntime.dispatchFetch(`${devOrigin}${path}`, { ...init, headers });
  };
  const completeGoogleSignin = async ({ subject, email, displayName, returnTo }) => {
    const start = await dispatch(
      `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`,
      { redirect: "manual" },
    );
    assert.equal(start.status, 302);
    const flow = flowFromStart(start);
    const now = Math.floor(Date.now() / 1_000);
    googleIdToken = signedRs256Jwt({
      iss: "https://accounts.google.com",
      aud: googleClientId,
      azp: googleClientId,
      sub: subject,
      email,
      email_verified: true,
      name: displayName,
      nonce: flow.payload.nonce,
      iat: now,
      exp: now + 300,
    }, googleKeys.privateKey, googleKeyId);
    const callback = await dispatch(
      `/api/auth/google/callback?code=valid-code&state=${flow.payload.state}`,
      { headers: { cookie: flow.cookie }, redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), returnTo);
    const sessionMatch = /(__Host-chessriot-google-session=[^;,]+)/.exec(
      callback.headers.get("set-cookie") ?? "",
    );
    assert.ok(sessionMatch);
    return {
      accountId: signedGoogleSession(subject, displayName).accountId,
      cookie: sessionMatch[1],
    };
  };
  try {
    const sessionStatus = await dispatch("/api/auth/session");
    assert.deepEqual(await sessionStatus.json(), {
      available: true,
      signedIn: false,
      needsUsername: false,
      account: null,
      features: { magicRules: false },
      featureRequests: { magicRules: null },
    });
    const database = await googleRuntime.getD1Database("DB");
    const referralOwner = {
      email: "oauth-referrer@players.chessriot.test",
      displayName: "OAuth Referrer",
    };
    const referralOwnerSession = signedGoogleSession(
      referralOwner.email,
      referralOwner.displayName,
    );
    const referralOwnerUsername = usernameForAccount(referralOwner);
    const referralCode = "R".repeat(16);
    const referralNow = new Date().toISOString();
    await database
      .prepare(`INSERT INTO accounts (
        id, display_name, username, username_canonical, username_set_at,
        created_at, last_seen_at, last_captcha_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        referralOwnerSession.accountId,
        referralOwner.displayName,
        referralOwnerUsername,
        referralOwnerUsername.toLowerCase(),
        referralNow,
        referralNow,
        referralNow,
        referralNow,
      )
      .run();
    await database
      .prepare("INSERT INTO referral_links (account_id, code, created_at) VALUES (?, ?, ?)")
      .bind(referralOwnerSession.accountId, referralCode, referralNow)
      .run();
    const referralReturnTo = `/invite/${referralCode}`;
    const start = await dispatch(
      `/api/auth/google/start?return_to=${encodeURIComponent(referralReturnTo)}`,
      {
      redirect: "manual",
      },
    );
    assert.equal(start.status, 302);
    assert.equal(
      new URL(start.headers.get("location")).searchParams.get("redirect_uri"),
      `${devOrigin}/api/auth/google/callback`,
    );
    assert.match(start.headers.get("set-cookie") ?? "", /__Host-chessriot-google-flow=/);
    const successfulFlow = flowFromStart(start);
    const now = Math.floor(Date.now() / 1_000);
    const googleSubject = "callback-player";
    googleIdToken = signedRs256Jwt({
      iss: "https://accounts.google.com",
      aud: googleClientId,
      azp: googleClientId,
      sub: googleSubject,
      email: "callback.player@example.com",
      email_verified: true,
      name: "Callback Player",
      nonce: successfulFlow.payload.nonce,
      iat: now,
      exp: now + 300,
    }, googleKeys.privateKey, googleKeyId);
    const callback = await dispatch(
      `/api/auth/google/callback?code=valid-code&state=${successfulFlow.payload.state}`,
      {
        headers: { cookie: successfulFlow.cookie },
        redirect: "manual",
      },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), referralReturnTo);
    const callbackCookies = callback.headers.get("set-cookie") ?? "";
    assert.match(callbackCookies, /__Host-chessriot-google-flow=;/);
    const sessionMatch = /(__Host-chessriot-google-session=[^;,]+)/.exec(callbackCookies);
    assert.ok(sessionMatch);
    assert.match(callbackCookies, /Max-Age=31536000/);
    const callbackGoogle = {
      accountId: "google_" + createHmac("sha256", accountIdSecret)
        .update(`google-sub:v1:${googleSubject}`)
        .digest("base64url"),
      cookie: sessionMatch[1],
    };
    assert.deepEqual(
      await database
        .prepare("SELECT id, display_name FROM accounts WHERE id = ?")
        .bind(callbackGoogle.accountId)
        .first(),
      { id: callbackGoogle.accountId, display_name: "Callback Player" },
    );
    assert.deepEqual(
      await database
        .prepare(`SELECT referrer_account_id, status, credits
          FROM referral_attributions WHERE referred_account_id = ?`)
        .bind(callbackGoogle.accountId)
        .first(),
      {
        referrer_account_id: referralOwnerSession.accountId,
        status: "pending",
        credits: 0,
      },
    );
    const usernameResponse = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: callbackGoogle.cookie },
      body: JSON.stringify({ username: "Callback_Player" }),
    });
    assert.equal(usernameResponse.status, 201);
    const usernamePayload = await usernameResponse.json();
    assert.equal(usernamePayload.account.username, "Callback_Player");
    assert.equal(usernamePayload.referral.state, "rewarded");
    assert.equal(usernamePayload.referral.creditsAwarded, 10);

    const unicodeOauth = await completeGoogleSignin({
      subject: "unicode-hebrew-player",
      email: "unicode.hebrew@example.com",
      displayName: "שחקן בינלאומי",
      returnTo: "/app",
    });
    const unicodeUsername = "רון_棋手";
    const unicodeClaim = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: unicodeOauth.cookie },
      body: JSON.stringify({ username: unicodeUsername }),
    });
    assert.equal(unicodeClaim.status, 201);
    assert.equal((await unicodeClaim.json()).account.username, unicodeUsername);
    assert.deepEqual(
      await database
        .prepare("SELECT username, username_canonical FROM accounts WHERE id = ?")
        .bind(unicodeOauth.accountId)
        .first(),
      { username: unicodeUsername, username_canonical: unicodeUsername },
    );

    const unicodeCollisionOauth = await completeGoogleSignin({
      subject: "unicode-collision-player",
      email: "unicode.collision@example.com",
      displayName: "Unicode Collision",
      returnTo: "/app",
    });
    const unicodeCollision = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: unicodeCollisionOauth.cookie },
      body: JSON.stringify({ username: unicodeUsername }),
    });
    assert.equal(unicodeCollision.status, 409);
    assert.equal((await unicodeCollision.json()).error.code, "unavailable");

    assert.deepEqual(
      await database
        .prepare(`SELECT status, credits FROM referral_attributions
          WHERE referred_account_id = ?`)
        .bind(callbackGoogle.accountId)
        .first(),
      { status: "rewarded", credits: 10 },
    );
    assert.equal(
      (await database
        .prepare(`SELECT status FROM friend_requests
          WHERE pair_key = ?`)
        .bind([referralOwnerSession.accountId, callbackGoogle.accountId].sort().join(":"))
        .first()).status,
      "accepted",
    );

    const replayedReferral = await dispatch(`/api/referrals/${referralCode}/claim`, {
      method: "POST",
      headers: { cookie: callbackGoogle.cookie },
    });
    assert.equal(replayedReferral.status, 200);
    assert.deepEqual(await replayedReferral.json(), {
      ok: true,
      state: "rewarded",
      inviterUsername: referralOwnerUsername,
      creditsAwarded: 0,
      creditBalance: 20,
    });

    const alternateReferrer = {
      email: "alternate-oauth-referrer@players.chessriot.test",
      displayName: "Alternate OAuth Referrer",
    };
    const alternateReferrerSession = signedGoogleSession(
      alternateReferrer.email,
      alternateReferrer.displayName,
    );
    const alternateReferrerUsername = usernameForAccount(alternateReferrer);
    const alternateReferralCode = "A".repeat(16);
    await database
      .prepare(`INSERT INTO accounts (
        id, display_name, username, username_canonical, username_set_at,
        created_at, last_seen_at, last_captcha_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        alternateReferrerSession.accountId,
        alternateReferrer.displayName,
        alternateReferrerUsername,
        alternateReferrerUsername.toLowerCase(),
        referralNow,
        referralNow,
        referralNow,
        referralNow,
      )
      .run();
    await database
      .prepare("INSERT INTO referral_links (account_id, code, created_at) VALUES (?, ?, ?)")
      .bind(alternateReferrerSession.accountId, alternateReferralCode, referralNow)
      .run();

    const existingIncompleteSubject = "existing-incomplete-oauth-player";
    const existingIncomplete = signedGoogleSession(
      existingIncompleteSubject,
      "Existing Incomplete",
    );
    const existingIncompleteSession = await dispatch("/api/auth/session", {
      headers: { cookie: existingIncomplete.cookie },
    });
    assert.equal(existingIncompleteSession.status, 200);
    assert.equal((await existingIncompleteSession.json()).needsUsername, true);
    const existingIncompleteOauth = await completeGoogleSignin({
      subject: existingIncompleteSubject,
      email: "existing.incomplete@example.com",
      displayName: "Existing Incomplete",
      returnTo: referralReturnTo,
    });
    assert.equal(existingIncompleteOauth.accountId, existingIncomplete.accountId);
    assert.equal(
      await database
        .prepare("SELECT status FROM referral_attributions WHERE referred_account_id = ?")
        .bind(existingIncomplete.accountId)
        .first(),
      null,
    );

    const usernameTakenSubject = "username-taken-oauth-player";
    const usernameTakenOauth = await completeGoogleSignin({
      subject: usernameTakenSubject,
      email: "username.taken@example.com",
      displayName: "Username Taken OAuth Player",
      returnTo: referralReturnTo,
    });
    assert.deepEqual(
      await database
        .prepare(`SELECT referrer_account_id, referral_code, status, credits
          FROM referral_attributions WHERE referred_account_id = ?`)
        .bind(usernameTakenOauth.accountId)
        .first(),
      {
        referrer_account_id: referralOwnerSession.accountId,
        referral_code: referralCode,
        status: "pending",
        credits: 0,
      },
    );

    const alternateClaim = await dispatch(
      `/api/referrals/${alternateReferralCode}/claim`,
      { method: "POST", headers: { cookie: usernameTakenOauth.cookie } },
    );
    assert.equal(alternateClaim.status, 409);
    assert.equal((await alternateClaim.json()).error.code, "already_attributed");
    assert.deepEqual(
      await database
        .prepare(`SELECT referrer_account_id, referral_code, status, credits
          FROM referral_attributions WHERE referred_account_id = ?`)
        .bind(usernameTakenOauth.accountId)
        .first(),
      {
        referrer_account_id: referralOwnerSession.accountId,
        referral_code: referralCode,
        status: "pending",
        credits: 0,
      },
    );

    const takenUsername = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: usernameTakenOauth.cookie },
      body: JSON.stringify({ username: referralOwnerUsername }),
    });
    assert.equal(takenUsername.status, 409);
    assert.equal((await takenUsername.json()).error.code, "unavailable");
    assert.deepEqual(
      await database
        .prepare(`SELECT accounts.username, attributions.status, attributions.credits
          FROM accounts
          JOIN referral_attributions AS attributions
            ON attributions.referred_account_id = accounts.id
          WHERE accounts.id = ?`)
        .bind(usernameTakenOauth.accountId)
        .first(),
      { username: null, status: "pending", credits: 0 },
    );
    assert.deepEqual(
      await database
        .prepare(`SELECT COUNT(*) AS friend_count FROM friend_requests
          WHERE sender_account_id = ? OR recipient_account_id = ?`)
        .bind(usernameTakenOauth.accountId, usernameTakenOauth.accountId)
        .first(),
      { friend_count: 0 },
    );
    assert.deepEqual(
      await database
        .prepare(`SELECT
          COALESCE(SUM(CASE WHEN status = 'rewarded' THEN credits ELSE 0 END), 0) AS credits,
          COUNT(CASE WHEN status = 'rewarded' THEN 1 END) AS invited_players
          FROM referral_attributions WHERE referrer_account_id = ?`)
        .bind(referralOwnerSession.accountId)
        .first(),
      { credits: 10, invited_players: 1 },
    );
    assert.deepEqual(
      await database
        .prepare(`SELECT
          COALESCE(SUM(CASE WHEN status = 'rewarded' THEN credits ELSE 0 END), 0) AS credits,
          COUNT(CASE WHEN status = 'rewarded' THEN 1 END) AS invited_players
          FROM referral_attributions WHERE referrer_account_id = ?`)
        .bind(alternateReferrerSession.accountId)
        .first(),
      { credits: 0, invited_players: 0 },
    );

    const failedStart = await dispatch("/api/auth/google/start", { redirect: "manual" });
    const failedFlow = flowFromStart(failedStart);
    const failedCallback = await dispatch(
      `/api/auth/google/callback?code=failed-code&state=${failedFlow.payload.state}`,
      { headers: { cookie: failedFlow.cookie }, redirect: "manual" },
    );
    assert.equal(failedCallback.status, 303);
    assert.equal(failedCallback.headers.get("location"), "/app?auth=google_failed");
    assert.match(
      failedCallback.headers.get("set-cookie") ?? "",
      /__Host-chessriot-google-flow=;[^,]*Max-Age=0/,
    );
    assert.doesNotMatch(
      failedCallback.headers.get("set-cookie") ?? "",
      /__Host-chessriot-google-session=/,
    );

    const aliasStart = await googleRuntime.dispatchFetch(
      "https://chessriot-dev.ripper234.chatgpt.site/api/auth/google/start",
      { redirect: "manual" },
    );
    assert.equal(aliasStart.status, 307);
    assert.equal(
      aliasStart.headers.get("location"),
      `${devOrigin}/api/auth/google/start`,
    );
    const guestToken = secret();
    const playerToken = secret();
    const inviteToken = secret();
    const createdResponse = await dispatch("/api/games", {
      method: "POST",
      headers: { cookie: callbackGoogle.cookie },
      body: JSON.stringify({
        displayName: "Portable Guest",
        guestToken,
        playerToken,
        inviteToken,
        requestId: randomUUID(),
        mode: "multiplayer",
        turnPaceDays: 3,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const gameId = created.game.id;
    const legacyGuestAccountId = "guest_" + createHash("sha256")
      .update(`chessriot-guest:${guestToken}`)
      .digest("base64url");
    const legacyNow = new Date().toISOString();
    await database
      .prepare(`INSERT INTO accounts (id, display_name, created_at, last_seen_at, last_captcha_at)
        VALUES (?, 'Portable Guest', ?, ?, ?)`)
      .bind(legacyGuestAccountId, legacyNow, legacyNow, legacyNow)
      .run();
    await database
      .prepare("UPDATE game_memberships SET account_id = ? WHERE game_id = ? AND color = 'w'")
      .bind(legacyGuestAccountId, gameId)
      .run();
    const guestMembership = await database
      .prepare("SELECT account_id FROM game_memberships WHERE game_id = ? AND color = 'w'")
      .bind(gameId)
      .first();
    assert.match(guestMembership.account_id, /^guest_/);
    const timestamp = new Date().toISOString();
    await database
      .prepare(`INSERT INTO push_subscriptions (
        id, game_id, color, account_id, endpoint_hash, endpoint, p256dh, auth,
        expiration_time, created_at, updated_at, failure_count
      ) VALUES (?, ?, 'w', ?, ?, ?, ?, ?, NULL, ?, ?, 0)`)
      .bind(
        randomUUID(),
        gameId,
        guestMembership.account_id,
        "e".repeat(64),
        `https://fcm.googleapis.com/fcm/send/${secret()}`,
        pushClientPublicKey,
        randomBytes(16).toString("base64url"),
        timestamp,
        timestamp,
      )
      .run();

    const ordinaryRead = await dispatch(`/api/games/${gameId}`, {
      headers: {
        authorization: `Bearer ${playerToken}`,
        cookie: callbackGoogle.cookie,
      },
    });
    assert.equal(ordinaryRead.status, 200);
    assert.equal(
      (await database
        .prepare("SELECT account_id FROM game_memberships WHERE game_id = ? AND color = 'w'")
        .bind(gameId)
        .first()).account_id,
      callbackGoogle.accountId,
    );
    assert.equal(
      (await database
        .prepare("SELECT account_id FROM push_subscriptions WHERE game_id = ? AND color = 'w'")
        .bind(gameId)
        .first()).account_id,
      callbackGoogle.accountId,
    );

    const accountGames = await dispatch("/api/me/games", {
      headers: { cookie: callbackGoogle.cookie },
    });
    assert.equal(accountGames.status, 200);
    assert.equal((await accountGames.json()).games[0].id, gameId);

    const signedOutPrivateLink = await dispatch(`/api/games/${gameId}`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    assert.equal(signedOutPrivateLink.status, 401);

    const blackPlayerToken = secret();
    const blackGuestToken = secret();
    const blackGoogle = signedGoogleSession("black-player", "Black Player");
    await dispatch("/api/auth/session", { headers: { cookie: blackGoogle.cookie } });
    const blackUsername = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: blackGoogle.cookie },
      body: JSON.stringify({ username: "Black_Player" }),
    });
    assert.equal(blackUsername.status, 201);
    const joinedResponse = await dispatch(`/api/invitations/${inviteToken}/join`, {
      method: "POST",
      headers: { cookie: blackGoogle.cookie },
      body: JSON.stringify({
        displayName: "Portable Opponent",
        guestToken: blackGuestToken,
        playerToken: blackPlayerToken,
      }),
    });
    assert.equal(joinedResponse.status, 200);
    const blackGuestAccountId = "guest_" + createHash("sha256")
      .update(`chessriot-guest:${blackGuestToken}`)
      .digest("base64url");
    await database
      .prepare(`INSERT INTO accounts (id, display_name, created_at, last_seen_at, last_captcha_at)
        VALUES (?, 'Portable Opponent', ?, ?, ?)`)
      .bind(blackGuestAccountId, legacyNow, legacyNow, legacyNow)
      .run();
    await database
      .prepare("UPDATE game_memberships SET account_id = ? WHERE game_id = ? AND color = 'b'")
      .bind(blackGuestAccountId, gameId)
      .run();
    const exactBlackSeat = await dispatch(`/api/games/${gameId}`, {
      headers: {
        authorization: `Bearer ${blackPlayerToken}`,
        cookie: blackGoogle.cookie,
      },
    });
    assert.equal(exactBlackSeat.status, 200);
    assert.equal((await exactBlackSeat.json()).game.you.color, "b");
    assert.equal(
      (await database
        .prepare("SELECT account_id FROM game_memberships WHERE game_id = ? AND color = 'b'")
        .bind(gameId)
        .first()).account_id,
      blackGoogle.accountId,
    );

    const otherGoogle = signedGoogleSession("other-player", "Other Player");
    await dispatch("/api/auth/session", { headers: { cookie: otherGoogle.cookie } });
    const otherUsername = await dispatch("/api/me/username", {
      method: "POST",
      headers: { cookie: otherGoogle.cookie },
      body: JSON.stringify({ username: "Other_Player" }),
    });
    assert.equal(otherUsername.status, 201);
    const wrongSeat = await dispatch(`/api/games/${gameId}`, {
      headers: {
        authorization: `Bearer ${secret()}`,
        cookie: otherGoogle.cookie,
      },
    });
    assert.equal(wrongSeat.status, 404);

    const llmSmokeGrant = opsGrant({
      aud: "development",
      scope: "llm:smoke",
    });
    const smokeResponses = await Promise.all([
      dispatch("/api/ops/llm-smoke", {
        method: "POST",
        headers: {
          origin: controlOrigin,
          "content-type": "text/plain",
        },
        body: llmSmokeGrant,
      }),
      dispatch("/api/ops/llm-smoke", {
        method: "POST",
        headers: {
          origin: controlOrigin,
          "content-type": "text/plain",
        },
        body: llmSmokeGrant,
      }),
    ]);
    assert.deepEqual(
      smokeResponses.map((response) => response.status).sort(),
      [200, 409],
    );
    assert.equal(openAiRequests, 1);
    const smokeSuccess = smokeResponses.find((response) => response.status === 200);
    assert.deepEqual(await smokeSuccess.json(), {
      environment: "development",
      ok: true,
      model: "gpt-5.6-luna",
      status: 200,
      requestId: "req_chessriot_smoke",
      error: null,
    });

  } finally {
    await googleRuntime.dispose();
  }
}

async function verifyVariantMigration() {
  const migrationRoot = await mkdtemp(join(tmpdir(), "chessriot-migration-"));
  const migrationRuntime = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } };",
    modules: true,
    compatibilityDate: runtimeConfig.cloudflareCompatibilityDate,
    d1Databases: { DB: "chessriot-migration" },
    resourcePersistencePath: migrationRoot,
  });
  try {
    const database = await migrationRuntime.getD1Database("DB");
    await database
      .prepare("CREATE TABLE games (id TEXT PRIMARY KEY NOT NULL)")
      .run();
    await database
      .prepare("INSERT INTO games (id) VALUES ('legacy-game')")
      .run();
    await database
      .prepare(`CREATE TABLE game_settings (
        game_id TEXT PRIMARY KEY NOT NULL,
        game_mode TEXT NOT NULL DEFAULT 'multiplayer'
          CHECK (game_mode IN ('solo', 'multiplayer')),
        ai_difficulty INTEGER
          CHECK (ai_difficulty IS NULL OR ai_difficulty BETWEEN 1 AND 5),
        human_color TEXT NOT NULL DEFAULT 'w'
          CHECK (human_color IN ('w', 'b')),
        turn_pace_days INTEGER
          CHECK (turn_pace_days IS NULL OR turn_pace_days IN (1, 3, 5)),
        magic_prompt TEXT,
        magic_rules_json TEXT,
        CHECK (
          (game_mode = 'solo' AND ai_difficulty IS NOT NULL) OR
          (game_mode = 'multiplayer' AND ai_difficulty IS NULL)
        )
      )`)
      .run();
    await database
      .prepare(`INSERT INTO game_settings (
        game_id, game_mode, ai_difficulty, human_color, turn_pace_days,
        magic_prompt, magic_rules_json
      ) VALUES ('legacy-game', 'multiplayer', NULL, 'w', 3, NULL, NULL)`)
      .run();
    for (const migrationPath of [
      "drizzle/0011_wandering_komodo.sql",
      "drizzle/0012_massive_domino.sql",
    ]) {
      const migration = await readFile(resolve(migrationPath), "utf8");
      for (const statement of migration
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await database.prepare(statement.replace(/;$/, "")).run();
      }
    }
    const legacy = await database
      .prepare("SELECT variant_id FROM game_settings WHERE game_id = 'legacy-game'")
      .first();
    assert.equal(legacy.variant_id, "standard");
    for (const variantId of [
      "mate-pawn",
      "mate-rook",
      "mate-two-bishops",
      "standard",
    ]) {
      await database
        .prepare("UPDATE game_settings SET variant_id = ? WHERE game_id = 'legacy-game'")
        .bind(variantId)
        .run();
    }
    await assert.rejects(
      database
        .prepare(`INSERT INTO game_settings (
          game_id, game_mode, variant_id, ai_difficulty, human_color
        ) VALUES ('bad-variant', 'solo', 'unknown', 3, 'w')`)
        .run(),
    );
    await assert.rejects(
      database
        .prepare(`INSERT INTO game_settings (
          game_id, game_mode, variant_id, ai_difficulty, human_color
        ) VALUES ('bad-mode', 'arcade', 'standard', NULL, 'w')`)
        .run(),
    );
  } finally {
    await migrationRuntime.dispose();
    await rm(migrationRoot, { recursive: true, force: true });
  }
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

  let resolvedAccount = null;
  if (!anonymous) {
    const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    let account = accountEmail
      ? { email: accountEmail, displayName: accountName || accountEmail.split("@")[0] }
      : bearer
        ? accountBySeatToken.get(bearer) || accountForUnknownSeat(bearer)
        : parsedBody?.displayName
          ? accountForLabel(parsedBody.displayName)
          : accountForLabel(accountName || "E2E Player");
    if (parsedBody?.playerToken && !accountEmail) {
      account = parsedBody.displayName
        ? accountForLabel(parsedBody.displayName)
        : account;
    }
    resolvedAccount = account;
    await prepareRegisteredAccount(runtime, account);
    for (const [name, value] of Object.entries(signedAccountHeaders(account))) {
      if (!headers.has(name)) headers.set(name, value);
    }
    if (!headers.has("cookie")) {
      headers.set("cookie", signedGoogleSession(account.email, account.displayName).cookie);
    }
  }
  const response = await runtime.dispatchFetch(`${origin}${path}`, { ...requestInit, headers });
  if (response.ok && resolvedAccount && parsedBody?.playerToken) {
    accountBySeatToken.set(parsedBody.playerToken, resolvedAccount);
  }
  return response;
}

async function body(response) {
  return response.status === 204 ? null : response.json();
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return true;
}

async function verifyFullMigrationChain() {
  const migrationRoot = await mkdtemp(join(tmpdir(), "chessriot-full-migration-"));
  const migrationRuntime = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } };",
    modules: true,
    compatibilityDate: runtimeConfig.cloudflareCompatibilityDate,
    d1Databases: { DB: "chessriot-full-migration" },
    resourcePersistencePath: migrationRoot,
  });
  try {
    const database = await migrationRuntime.getD1Database("DB");
    const migrationFiles = (await readdir(resolve("drizzle"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    assert.equal(migrationFiles[0]?.startsWith("0000_"), true);
    assert.equal(migrationFiles.at(-1)?.startsWith("0028_"), true);

    for (const file of migrationFiles) {
      const migration = await readFile(resolve("drizzle", file), "utf8");
      for (const statement of migration
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await database.prepare(statement.replace(/;$/, "")).run();
      }
    }

    const requiredTables = [
      "accounts",
      "account_blocks",
      "account_credit_ledger",
      "account_feature_flags",
      "account_notifications",
      "account_tombstones",
      "bot_turn_leases",
      "feedback",
      "feature_access_requests",
      "friend_requests",
      "game_actions",
      "game_memberships",
      "game_reactions",
      "game_recap_shares",
      "game_settings",
      "games",
      "magic_rule_compilations",
      "magic_rule_rejections",
      "magic_world_derivations",
      "magic_world_entitlements",
      "magic_world_sources",
      "magic_world_uses",
      "magic_worlds",
      "moves",
      "observability_events",
      "ops_action_nonces",
      "push_devices",
      "push_account_deliveries",
      "push_deliveries",
      "push_subscriptions",
      "push_turn_deliveries",
      "public_rate_limit_windows",
      "rate_limit_windows",
      "referral_attributions",
      "referral_links",
      "runtime_invariants",
      "safety_reports",
      "safety_report_archive",
    ];
    const tables = await database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})`)
      .bind(...requiredTables)
      .all();
    assert.deepEqual(
      tables.results.map((row) => row.name).sort(),
      [...requiredTables].sort(),
    );
    const settingsColumns = await database.prepare("PRAGMA table_info(game_settings)").all();
    assert.equal(settingsColumns.results.some((column) => column.name === "variant_id"), true);
    assert.equal(settingsColumns.results.some((column) => column.name === "world_code"), true);
    const entitlementColumns = await database
      .prepare("PRAGMA table_info(magic_world_entitlements)")
      .all();
    const requestFingerprintColumn = entitlementColumns.results
      .find((column) => column.name === "request_fingerprint");
    assert.equal(requestFingerprintColumn?.notnull, 1);
    const worldUseColumns = await database.prepare("PRAGMA table_info(magic_world_uses)").all();
    assert.equal(worldUseColumns.results.some((column) => column.name === "human_played_at"), true);
    const deliveryColumns = await database.prepare("PRAGMA table_info(push_deliveries)").all();
    for (const name of ["attempt_count", "next_attempt_at", "lease_token", "lease_until"]) {
      assert.equal(deliveryColumns.results.some((column) => column.name === name), true);
    }
    const accountDeliveryColumns = await database
      .prepare("PRAGMA table_info(push_account_deliveries)")
      .all();
    for (const name of ["friend_request_id", "attempt_count", "next_attempt_at", "lease_token", "lease_until"]) {
      assert.equal(accountDeliveryColumns.results.some((column) => column.name === name), true);
    }
    const opsNonceColumns = await database.prepare("PRAGMA table_info(ops_action_nonces)").all();
    assert.equal(opsNonceColumns.results.some((column) => column.name === "result_json"), true);
    const worldUseTable = await database.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'magic_world_uses'`).first();
    assert.match(String(worldUseTable?.sql), /qualifies_for_royalty[^]*IN \(0, 1\)/);
    const accountColumns = await database.prepare("PRAGMA table_info(accounts)").all();
    const tutorialColumn = accountColumns.results.find((column) => column.name === "tutorial_status");
    assert.equal(tutorialColumn?.notnull, 1);
    assert.match(String(tutorialColumn?.dflt_value), /skipped/);
    const observabilityColumns = await database.prepare("PRAGMA table_info(observability_events)").all();
    assert.equal(observabilityColumns.results.some((column) => column.name === "actor_hash"), true);
    const notificationForeignKeys = await database.prepare("PRAGMA foreign_key_list(account_notifications)").all();
    assert.equal(notificationForeignKeys.results.length, 3);
    const clientEventIndex = await database.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'index' AND name = 'observability_client_request_unique'`).first();
    assert.match(String(clientEventIndex?.sql), /UNIQUE INDEX/);
    const analyticsIndexNames = [
      "accounts_created_idx",
      "friend_requests_created_idx",
      "games_created_idx",
      "games_finished_idx",
      "moves_created_idx",
      "observability_actor_time_idx",
      "referral_attributions_status_completed_idx",
    ];
    const analyticsIndexes = await database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'
        AND name IN (${analyticsIndexNames.map(() => "?").join(",")})`)
      .bind(...analyticsIndexNames)
      .all();
    assert.deepEqual(
      analyticsIndexes.results.map((row) => row.name).sort(),
      [...analyticsIndexNames].sort(),
    );
  } finally {
    await migrationRuntime.dispose();
    await rm(migrationRoot, { recursive: true, force: true });
  }
}

async function verifyAnalyticsAsFirstRequest() {
  const analyticsRuntime = createRuntime({ databaseName: "chessriot-analytics-first-request" });
  try {
    const database = await analyticsRuntime.getD1Database("DB");
    const migrationFiles = (await readdir(resolve("drizzle"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const file of migrationFiles) {
      const migration = await readFile(resolve("drizzle", file), "utf8");
      for (const statement of migration
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await database.prepare(statement.replace(/;$/, "")).run();
      }
    }

    const response = await analyticsRuntime.dispatchFetch(
      `${origin}/api/ops/analytics?window=7`,
      {
        method: "POST",
        headers: { "content-type": "text/plain", origin: controlOrigin },
        body: opsGrant(),
      },
    );
    assert.equal(response.status, 200);
    const analytics = await response.json();
    assert.equal(analytics.status, "ok");
    assert.equal(analytics.window.days, 7);
    assert.deepEqual(
      analytics.journeyMonitor.stages.map((stage) => stage.accounts),
      [0, 0, 0, 0],
    );
  } finally {
    await analyticsRuntime.dispose();
  }
}

async function verifyV20Upgrade() {
  const migrationRoot = await mkdtemp(join(tmpdir(), "chessriot-v20-upgrade-"));
  const migrationRuntime = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } };",
    modules: true,
    compatibilityDate: runtimeConfig.cloudflareCompatibilityDate,
    d1Databases: { DB: "chessriot-v20-upgrade" },
    resourcePersistencePath: migrationRoot,
  });
  try {
    const database = await migrationRuntime.getD1Database("DB");
    const migrationFiles = (await readdir(resolve("drizzle"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const applyMigration = async (file) => {
      const migration = await readFile(resolve("drizzle", file), "utf8");
      for (const statement of migration
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        await database.prepare(statement.replace(/;$/, "")).run();
      }
    };
    for (const file of migrationFiles.filter((name) => name < "0016_")) {
      await applyMigration(file);
    }
    const now = new Date().toISOString();
    await database.prepare(`INSERT INTO accounts (
      id, display_name, username, username_canonical, username_set_at,
      created_at, last_seen_at, last_captcha_at
    ) VALUES ('legacy-account', 'Legacy Account', 'LegacyKnight',
      'legacyknight', ?, ?, ?, ?)`)
      .bind(now, now, now, now)
      .run();
    await database.prepare(`INSERT INTO accounts (
      id, display_name, username, username_canonical, username_set_at,
      created_at, last_seen_at, last_captcha_at
    ) VALUES
      ('legacy-referrer', 'Legacy Referrer', 'LegacyReferrer',
        'legacyreferrer', ?, ?, ?, ?),
      ('legacy-referred', 'Legacy Referred', 'LegacyReferred',
        'legacyreferred', ?, ?, ?, ?)`)
      .bind(now, now, now, now, now, now, now, now)
      .run();
    await database.prepare(`INSERT INTO referral_links (
      account_id, code, created_at
    ) VALUES ('legacy-referrer', 'legacyinvite0001', ?)`)
      .bind(now)
      .run();
    await database.prepare(`INSERT INTO referral_attributions (
      referred_account_id, referrer_account_id, referral_code, status,
      credits, created_at, completed_at
    ) VALUES (
      'legacy-referred', 'legacy-referrer', 'legacyinvite0001', 'rewarded',
      100, ?, ?
    )`)
      .bind(now, now)
      .run();
    await database.prepare(`INSERT INTO observability_events (
      id, occurred_at, environment, app_version, event_name, outcome
    ) VALUES ('legacy-event', ?, 'development', '0.20.0', 'api.request', 'success')`)
      .bind(now)
      .run();
    await database.prepare(`INSERT INTO account_feature_flags (
      account_id, feature_key, enabled, updated_at
    ) VALUES ('legacy-account', 'magic_rules', 1, ?)`)
      .bind(now)
      .run();
    await database.prepare(`INSERT INTO magic_rule_compilations (
      cache_key, compiler_version, status, rules_json,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (
      'legacy-ready-compilation', 'legacy-v1', 'ready',
      '{"version":3,"rules":[]}', NULL, NULL, ?, ?
    )`)
      .bind(now, now)
      .run();
    for (const file of migrationFiles.filter((name) => name >= "0016_")) {
      await applyMigration(file);
    }
    assert.deepEqual(
      await database.prepare(`SELECT username, tutorial_status FROM accounts
        WHERE id = 'legacy-account'`).first(),
      { username: "LegacyKnight", tutorial_status: "skipped" },
    );
    assert.deepEqual(
      await database.prepare(`SELECT event_name, actor_hash FROM observability_events
        WHERE id = 'legacy-event'`).first(),
      { event_name: "api.request", actor_hash: null },
    );
    assert.deepEqual(
      await database.prepare(`SELECT feature_key, enabled FROM account_feature_flags
        WHERE account_id = 'legacy-account'`).first(),
      { feature_key: "magic_rules", enabled: 1 },
    );
    assert.deepEqual(
      await database.prepare(`SELECT status, world_code FROM magic_rule_compilations
        WHERE cache_key = 'legacy-ready-compilation'`).first(),
      { status: "compiled", world_code: null },
    );
    assert.deepEqual(
      await database.prepare(`SELECT amount, reason FROM account_credit_ledger
        WHERE account_id = 'legacy-account'`).first(),
      { amount: 10, reason: "starter" },
    );
    assert.deepEqual(
      await database.prepare(`SELECT status, credits FROM referral_attributions
        WHERE referred_account_id = 'legacy-referred'`).first(),
      { status: "rewarded", credits: 10 },
    );
    assert.deepEqual(
      (await database.prepare(`SELECT amount, reason, source_key
        FROM account_credit_ledger WHERE account_id = 'legacy-referrer'
        ORDER BY reason`).all()).results,
      [
        { amount: 10, reason: "referral", source_key: "referral:legacy-referred" },
        { amount: 10, reason: "starter", source_key: "starter:legacy-referrer" },
      ],
    );
  } finally {
    await migrationRuntime.dispose();
    await rm(migrationRoot, { recursive: true, force: true });
  }
}

async function verifyHealthIsReadOnly() {
  const healthRuntime = createRuntime({
    databaseName: "chessriot-health-readonly-e2e",
  });
  try {
    const response = await healthRuntime.dispatchFetch(`${origin}/api/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).database, "error");
    const database = await healthRuntime.getD1Database("DB");
    assert.deepEqual(
      await database.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).first(),
      { count: 0 },
    );
  } finally {
    await healthRuntime.dispose();
  }
}

async function verifyStorageContinuityMirror() {
  const bucketName = "chessriot-continuity-shared-bucket";
  const originalRuntime = createRuntime({
    databaseName: "chessriot-continuity-original-e2e",
    bucketName,
  });
  try {
    const database = await originalRuntime.getD1Database("DB");
    await database.prepare(`CREATE TABLE runtime_invariants (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      storage_epoch TEXT NOT NULL UNIQUE,
      environment TEXT NOT NULL,
      account_identity_marker TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`).run();
    const response = await originalRuntime.dispatchFetch(`${origin}/`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.equal(await waitFor(async () => Boolean(await database
      .prepare("SELECT storage_epoch FROM runtime_invariants WHERE id = 1")
      .first()), 2_000), true);
    const row = await database
      .prepare("SELECT storage_epoch, environment FROM runtime_invariants WHERE id = 1")
      .first();
    const mirrorObject = await (await originalRuntime.getR2Bucket("BUCKET"))
      .get("operations/chessriot-storage-epoch-v1.json");
    assert.ok(mirrorObject);
    assert.deepEqual(await mirrorObject.json(), {
      storageEpoch: row.storage_epoch,
      environment: row.environment,
    });
  } finally {
    await originalRuntime.dispose();
  }

  const swappedRuntime = createRuntime({
    databaseName: "chessriot-continuity-swapped-e2e",
    bucketName,
  });
  try {
    const response = await swappedRuntime.dispatchFetch(`${origin}/api/auth/session`, {
      headers: {
        origin,
        cookie: signedGoogleSession(
          "continuity@players.chessriot.test",
          "Continuity Player",
        ).cookie,
      },
    });
    assert.ok(response.status >= 500);
    const database = await swappedRuntime.getD1Database("DB");
    assert.equal(
      await database.prepare("SELECT storage_epoch FROM runtime_invariants WHERE id = 1").first(),
      null,
    );
  } finally {
    await swappedRuntime.dispose();
  }
}

await verifyFullMigrationChain();
await verifyAnalyticsAsFirstRequest();
await verifyV20Upgrade();
await verifyVariantMigration();
await verifyGoogleSessionHardening();
await verifyGoogleAccountFlow();
await verifyHealthIsReadOnly();
await verifyStorageContinuityMirror();
// Preliminary isolated runtimes can now exercise acceptance-triggered pushes.
// The main runtime's delivery assertions use their own explicit baseline.
outboundPushRequests.splice(0, outboundPushRequests.length);
let runtime = createRuntime();
try {
  const anonymousCreate = await request(runtime, "/api/games", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(anonymousCreate.status, 401);
  assert.equal((await body(anonymousCreate)).error.code, "sign_in_required");
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
  assert.equal(opaqueSameOriginCreate.status, 401);
  assert.equal((await body(opaqueSameOriginCreate)).error.code, "sign_in_required");
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

  const googleSessionUnavailable = await request(runtime, "/api/auth/session", {
    anonymous: true,
  });
  assert.equal(googleSessionUnavailable.status, 200);
  assert.deepEqual(await body(googleSessionUnavailable), {
    available: false,
    signedIn: false,
    needsUsername: false,
    account: null,
    features: { magicRules: false },
    featureRequests: { magicRules: null },
  });
  assert.equal((await request(runtime, "/api/auth/google/start", {
    anonymous: true,
    redirect: "manual",
  })).status, 503);
  const crossSiteSignout = await request(runtime, "/api/auth/signout", {
    anonymous: true,
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(crossSiteSignout.status, 403);
  const guestSignout = await request(runtime, "/api/auth/signout", {
    anonymous: true,
    method: "POST",
  });
  assert.equal(guestSignout.status, 200);
  assert.match(guestSignout.headers.get("set-cookie") ?? "", /__Host-chessriot-google-session=;/);
  assert.equal((await request(runtime, "/api/ops/llm-smoke", {
    anonymous: true,
    method: "POST",
    headers: { origin: controlOrigin, "content-type": "text/plain" },
    body: "invalid-grant",
  })).status, 403);

  const referralOwner = {
    email: "referral-owner@players.chessriot.test",
    displayName: "Referral Owner",
  };
  const referralOwnerUsername = usernameForAccount(referralOwner);
  const referralSummaryResponse = await request(runtime, "/api/me/referral", {
    accountEmail: referralOwner.email,
    accountName: referralOwner.displayName,
  });
  assert.equal(referralSummaryResponse.status, 200);
  const referralSummary = await body(referralSummaryResponse);
  assert.match(referralSummary.code, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(referralSummary.inviteUrl, `${origin}/invite/${referralSummary.code}`);
  assert.deepEqual(
    {
      credits: referralSummary.credits,
      invitedPlayers: referralSummary.invitedPlayers,
      creditsPerSignup: referralSummary.creditsPerSignup,
    },
    { credits: 10, invitedPlayers: 0, creditsPerSignup: 10 },
  );

  const selfReferral = await request(
    runtime,
    `/api/referrals/${referralSummary.code}/claim`,
    {
      method: "POST",
      accountEmail: referralOwner.email,
      accountName: referralOwner.displayName,
    },
  );
  assert.equal(selfReferral.status, 409);
  assert.equal((await body(selfReferral)).error.code, "self");

  const referredPlayer = {
    email: "new-referral@players.chessriot.test",
    displayName: "New Referral",
  };
  const referredSession = signedGoogleSession(referredPlayer.email, referredPlayer.displayName);
  const referredHeaders = {
    cookie: referredSession.cookie,
    origin,
  };
  const referredSessionResponse = await runtime.dispatchFetch(`${origin}/api/auth/session`, {
    headers: referredHeaders,
  });
  assert.equal(referredSessionResponse.status, 200);
  assert.equal((await referredSessionResponse.json()).needsUsername, true);

  const unqualifiedReferralVisit = await runtime.dispatchFetch(
    `${origin}/api/referrals/${referralSummary.code}/claim`,
    { method: "POST", headers: referredHeaders },
  );
  assert.equal(unqualifiedReferralVisit.status, 202);
  assert.equal((await unqualifiedReferralVisit.json()).state, "awaiting_username");

  const referredUsername = usernameForAccount(referredPlayer);
  const completeReferralUsername = await runtime.dispatchFetch(`${origin}/api/me/username`, {
    method: "POST",
    headers: { ...referredHeaders, "content-type": "application/json" },
    body: JSON.stringify({ username: referredUsername }),
  });
  assert.equal(completeReferralUsername.status, 201);
  const completedUsernamePayload = await completeReferralUsername.json();
  assert.equal(completedUsernamePayload.account.username, referredUsername);
  assert.equal(completedUsernamePayload.referral, null);

  const repeatReferralClaim = await runtime.dispatchFetch(
    `${origin}/api/referrals/${referralSummary.code}/claim`,
    { method: "POST", headers: referredHeaders },
  );
  assert.equal(repeatReferralClaim.status, 200);
  assert.equal((await repeatReferralClaim.json()).state, "connected");

  const unrewardedSummary = await body(await request(runtime, "/api/me/referral", {
    accountEmail: referralOwner.email,
    accountName: referralOwner.displayName,
  }));
  assert.equal(unrewardedSummary.code, referralSummary.code);
  assert.equal(unrewardedSummary.credits, 10);
  assert.equal(unrewardedSummary.invitedPlayers, 0);

  const referralFriends = await body(await request(runtime, "/api/me/friends", {
    accountEmail: referralOwner.email,
    accountName: referralOwner.displayName,
  }));
  assert.equal(
    referralFriends.friends.some((friend) => friend.username === referredUsername),
    true,
  );

  const existingReferralPlayer = {
    email: "existing-referral@players.chessriot.test",
    displayName: "Existing Referral",
  };
  const existingReferralClaim = await request(
    runtime,
    `/api/referrals/${referralSummary.code}/claim`,
    {
      method: "POST",
      accountEmail: existingReferralPlayer.email,
      accountName: existingReferralPlayer.displayName,
    },
  );
  assert.equal(existingReferralClaim.status, 200);
  assert.equal((await body(existingReferralClaim)).state, "connected");
  const unchangedRewardSummary = await body(await request(runtime, "/api/me/referral", {
    accountEmail: referralOwner.email,
    accountName: referralOwner.displayName,
  }));
  assert.equal(unchangedRewardSummary.credits, 10);
  assert.equal(unchangedRewardSummary.invitedPlayers, 0);

  const referralPage = await request(runtime, `/invite/${referralSummary.code}`, {
    anonymous: true,
  });
  assert.equal(referralPage.status, 200);
  const referralPageHtml = await referralPage.text();
  assert.match(referralPageHtml, /קישור לחיבור בין שחקנים/);
  assert.match(referralPageHtml, new RegExp(referralOwnerUsername));

  const friendAlice = {
    email: "friend-alice@players.chessriot.test",
    displayName: "Friend Alice",
  };
  const friendBob = {
    email: "friend-bob@players.chessriot.test",
    displayName: "Friend Bob",
  };
  const friendAliceUsername = usernameForAccount(friendAlice);
  const friendBobUsername = usernameForAccount(friendBob);
  assert.equal((await request(runtime, "/api/me/friends", {
    accountEmail: friendAlice.email,
    accountName: friendAlice.displayName,
  })).status, 200);
  assert.equal((await request(runtime, "/api/me/friends", {
    accountEmail: friendBob.email,
    accountName: friendBob.displayName,
  })).status, 200);

  const friendRequestResponse = await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: friendAlice.email,
    accountName: friendAlice.displayName,
    body: JSON.stringify({ username: friendBobUsername }),
  });
  assert.equal(friendRequestResponse.status, 201);
  const friendRequestId = (await body(friendRequestResponse)).requestId;
  assert.equal(typeof friendRequestId, "string");

  const friendBobPending = await request(runtime, "/api/me/friends", {
    accountEmail: friendBob.email,
    accountName: friendBob.displayName,
  });
  assert.equal(friendBobPending.status, 200);
  assert.deepEqual((await body(friendBobPending)).incoming.map((item) => item.username), [
    friendAliceUsername,
  ]);

  const friendAcceptResponse = await request(
    runtime,
    `/api/me/friend-requests/${friendRequestId}`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "accept" }),
    },
  );
  assert.equal(friendAcceptResponse.status, 200);

  const challengeCreatorPushEndpoint = `https://fcm.googleapis.com/fcm/send/${secret()}`;
  const challengeCreatorPush = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: friendAlice.email,
    accountName: friendAlice.displayName,
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: friendAliceUsername,
      subscription: {
        endpoint: challengeCreatorPushEndpoint,
        expirationTime: null,
        keys: {
          p256dh: pushClientPublicKey,
          auth: randomBytes(16).toString("base64url"),
        },
      },
    }),
  });
  assert.equal(challengeCreatorPush.status, 200);

  const friendChallengeResponse = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: friendAlice.email,
    accountName: friendAlice.displayName,
    body: JSON.stringify({
      displayName: friendAlice.displayName,
      mode: "multiplayer",
      opponentUsername: friendBobUsername,
      turnPaceDays: 5,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(friendChallengeResponse.status, 201);
  const friendChallenge = await body(friendChallengeResponse);
  assert.equal(friendChallenge.inviteUrl, undefined);
  assert.equal(friendChallenge.game.status, "waiting");
  assert.equal(friendChallenge.game.turnPaceDays, 5);
  assert.equal(friendChallenge.game.deadlineAt, null);
  assert.equal(friendChallenge.game.players.white.name, friendAliceUsername);
  assert.equal(friendChallenge.game.players.black.name, friendBobUsername);

  const creatorCannotAccept = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendAlice.email,
      accountName: friendAlice.displayName,
      body: JSON.stringify({ action: "accept", requestId: randomUUID() }),
    },
  );
  assert.equal(creatorCannotAccept.status, 403);
  assert.equal((await body(creatorCannotAccept)).error.code, "challenge_response_forbidden");

  const strangerCannotAccept = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: "challenge-stranger@players.chessriot.test",
      accountName: "Challenge Stranger",
      body: JSON.stringify({ action: "accept", requestId: randomUUID() }),
    },
  );
  assert.equal(strangerCannotAccept.status, 404);

  const inviteeCannotCancelChallenge = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/end`,
    {
      method: "POST",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({
        expectedVersion: friendChallenge.game.version,
        requestId: randomUUID(),
      }),
    },
  );
  assert.equal(inviteeCannotCancelChallenge.status, 403);
  assert.equal(
    (await body(inviteeCannotCancelChallenge)).error.code,
    "game_cancel_forbidden",
  );

  const pendingChallengeActivity = await body(await request(
    runtime,
    "/api/me/activity",
    { accountEmail: friendBob.email, accountName: friendBob.displayName },
  ));
  const pendingChallengeItem = pendingChallengeActivity.items.find(
    (item) => item.gameId === friendChallenge.game.id,
  );
  assert.equal(pendingChallengeItem.kind, "challenge");
  assert.match(pendingChallengeItem.detail, /5 days per move/);

  const acceptChallengeRequestId = randomUUID();
  const challengePushCountBeforeAccept = outboundPushRequests.length;
  const acceptChallenge = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "accept", requestId: acceptChallengeRequestId }),
    },
  );
  assert.equal(acceptChallenge.status, 200);
  const acceptedChallenge = await body(acceptChallenge);
  assert.equal(acceptedChallenge.state, "accepted");
  assert.equal(acceptedChallenge.game.status, "active");
  assert.equal(acceptedChallenge.game.turnPaceDays, 5);
  assert.equal(
    Date.parse(acceptedChallenge.game.deadlineAt),
    Date.parse(acceptedChallenge.game.updatedAt) + 5 * 24 * 60 * 60_000,
  );
  assert.equal((await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/reactions`,
    {
      method: "POST",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
    },
  )).status, 201);
  assert.equal(acceptedChallenge.game.version, friendChallenge.game.version + 1);
  assert.equal(
    await waitFor(() => outboundPushRequests.length === challengePushCountBeforeAccept + 1),
    true,
  );
  assert.equal(
    outboundPushRequests[challengePushCountBeforeAccept].url,
    challengeCreatorPushEndpoint,
  );
  const challengePushDatabase = await runtime.getD1Database("DB");
  assert.deepEqual(
    await challengePushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries
      WHERE game_id = ? AND game_version = ? AND kind = 'your_turn'`)
      .bind(friendChallenge.game.id, acceptedChallenge.game.version)
      .first(),
    { count: 1 },
  );

  const idempotentChallengeAccept = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "accept", requestId: acceptChallengeRequestId }),
    },
  );
  assert.equal(idempotentChallengeAccept.status, 200);
  assert.equal((await body(idempotentChallengeAccept)).state, "accepted");
  assert.deepEqual(
    await challengePushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries
      WHERE game_id = ? AND game_version = ? AND kind = 'your_turn'`)
      .bind(friendChallenge.game.id, acceptedChallenge.game.version)
      .first(),
    { count: 1 },
  );
  assert.equal(outboundPushRequests.length, challengePushCountBeforeAccept + 1);
  outboundPushRequests.splice(challengePushCountBeforeAccept, 1);

  const conflictingChallengeAction = await request(
    runtime,
    `/api/games/${friendChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "decline", requestId: acceptChallengeRequestId }),
    },
  );
  assert.equal(conflictingChallengeAction.status, 409);
  assert.equal((await body(conflictingChallengeAction)).error.code, "idempotency_conflict");

  for (const account of [friendAlice, friendBob]) {
    const historyResponse = await request(
      runtime,
      "/api/me/games?mode=multiplayer&variant=standard&magic=no&limit=24",
      { accountEmail: account.email, accountName: account.displayName },
    );
    assert.equal(historyResponse.status, 200);
    assert.equal(
      (await body(historyResponse)).games.some((game) => game.id === friendChallenge.game.id),
      true,
    );
  }
  const noMagicHistory = await request(
    runtime,
    "/api/me/games?mode=all&variant=all&magic=yes&limit=24",
    { accountEmail: friendBob.email, accountName: friendBob.displayName },
  );
  assert.equal(noMagicHistory.status, 200);
  assert.deepEqual((await body(noMagicHistory)).games, []);

  const declinedChallengeResponse = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: friendAlice.email,
    accountName: friendAlice.displayName,
    body: JSON.stringify({
      displayName: friendAlice.displayName,
      mode: "multiplayer",
      opponentUsername: friendBobUsername,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(declinedChallengeResponse.status, 201);
  const declinedChallenge = await body(declinedChallengeResponse);
  assert.equal(declinedChallenge.game.status, "waiting");

  const declineRequestId = randomUUID();
  const declineChallenge = await request(
    runtime,
    `/api/games/${declinedChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "decline", requestId: declineRequestId }),
    },
  );
  assert.equal(declineChallenge.status, 200);
  const declined = await body(declineChallenge);
  assert.equal(declined.state, "declined");
  assert.equal(declined.game.status, "completed");
  assert.deepEqual(declined.game.outcome, { winner: null, reason: "cancelled" });
  assert.equal(declined.game.version, declinedChallenge.game.version + 1);
  assert.deepEqual(
    await challengePushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries WHERE game_id = ?`)
      .bind(declinedChallenge.game.id)
      .first(),
    { count: 0 },
  );

  const repeatDecline = await request(
    runtime,
    `/api/games/${declinedChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "decline", requestId: declineRequestId }),
    },
  );
  assert.equal(repeatDecline.status, 200);

  const acceptDeclinedChallenge = await request(
    runtime,
    `/api/games/${declinedChallenge.game.id}/challenge`,
    {
      method: "PATCH",
      accountEmail: friendBob.email,
      accountName: friendBob.displayName,
      body: JSON.stringify({ action: "accept", requestId: randomUUID() }),
    },
  );
  assert.equal(acceptDeclinedChallenge.status, 409);
  assert.equal((await body(acceptDeclinedChallenge)).error.code, "challenge_settled");

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
  })).status, 401);
  assert.equal((await request(runtime, `/api/invitations/${nonexistentInvite}`)).status, 404);
  assert.equal((await request(runtime, `/api/invitations/${nonexistentInvite}/join`, {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      displayName: "No Game",
      guestToken: secret(),
      playerToken: secret(),
    }),
  })).status, 401);
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
  assert.equal(guestCreateRetryWithAmbientIdentity.status, 409);

  const guestInviteResponse = await request(
    runtime,
    `/api/invitations/${guestInviteToken}`,
    {
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
    },
  );
  assert.equal(guestInviteResponse.status, 200);
  assert.equal(
    (await body(guestInviteResponse)).creatorName,
    usernameForAccount(accountForLabel("Guest White")),
  );
  assert.equal((await request(runtime, `/api/invitations/${guestInviteToken}`, {
    anonymous: true,
  })).status, 401);

  const sameGuestJoinResponse = await request(
    runtime,
    `/api/invitations/${guestInviteToken}/join`,
    {
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
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
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
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
      headers: {
        authorization: `Bearer ${guestWhiteToken}`,
        "x-push-endpoint-hash": guestPushEndpointHash,
      },
    },
  )), { available: true, enabled: false });
  assert.deepEqual(await body(await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      headers: {
        authorization: `Bearer ${guestBlackToken}`,
        "x-push-endpoint-hash": guestPushEndpointHash,
      },
    },
  )), { available: true, enabled: true });

  const guestWhiteGameResponse = await request(runtime, `/api/games/${guestGameId}`, {
    headers: { authorization: `Bearer ${guestWhiteToken}` },
  });
  assert.equal(guestWhiteGameResponse.status, 200);
  const guestWhiteGame = await body(guestWhiteGameResponse);
  const guestMoveRequestId = randomUUID();
  const guestMoveBody = JSON.stringify({
    from: "e2",
    to: "e4",
    expectedVersion: guestWhiteGame.game.version,
    requestId: guestMoveRequestId,
  });
  const guestMoveResponse = await request(runtime, `/api/games/${guestGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${guestWhiteToken}` },
    body: guestMoveBody,
  });
  assert.equal(guestMoveResponse.status, 200);
  assert.equal(guestMoveResponse.headers.get("x-chessriot-turn-committed"), "1");
  assert.equal((await body(guestMoveResponse)).game.plyCount, 1);
  assert.equal(await waitFor(() => outboundPushRequests.length === 1), true);
  assert.equal(outboundPushRequests.length, 1);
  assert.equal(outboundPushRequests[0].url, guestPushEndpoint);
  assert.equal(outboundPushRequests[0].method, "POST");
  assert.match(outboundPushRequests[0].authorization, /vapid/i);
  assert.equal(outboundPushRequests[0].encoding, "aes128gcm");
  assert.equal(outboundPushRequests[0].ttl, "86400");
  assert.equal(outboundPushRequests[0].body.includes(guestWhiteToken), false);
  assert.equal(outboundPushRequests[0].body.includes(guestBlackToken), false);
  assert.equal(
    (await pushDatabase
      .prepare("SELECT status FROM push_deliveries LIMIT 1")
      .first()).status,
    "sent",
  );
  const guestMoveRetry = await request(runtime, `/api/games/${guestGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${guestWhiteToken}` },
    body: guestMoveBody,
  });
  assert.equal(guestMoveRetry.status, 200);
  assert.equal(guestMoveRetry.headers.get("x-chessriot-turn-committed"), null);
  assert.equal(outboundPushRequests.length, 1);

  const reenableWhitePush = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: guestPushSubscription,
      }),
    },
  );
  assert.equal(reenableWhitePush.status, 200);
  const guestBlackGameResponse = await request(runtime, `/api/games/${guestGameId}`, {
    headers: { authorization: `Bearer ${guestBlackToken}` },
  });
  assert.equal(guestBlackGameResponse.status, 200);
  const guestBlackGame = await body(guestBlackGameResponse);
  forcedPushStatuses.push(503, 201);
  const blackMoveResponse = await request(runtime, `/api/games/${guestGameId}/moves`, {
    method: "POST",
    headers: { authorization: `Bearer ${guestBlackToken}` },
    body: JSON.stringify({
      from: "e7",
      to: "e5",
      expectedVersion: guestBlackGame.game.version,
      requestId: randomUUID(),
    }),
  });
  assert.equal(blackMoveResponse.status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 3, 4_000), true);
  assert.deepEqual(
    await pushDatabase.prepare(`SELECT status, status_code, attempt_count
      FROM push_deliveries WHERE game_id = ? AND game_version = 3`)
      .bind(guestGameId)
      .first(),
    { status: "sent", status_code: 201, attempt_count: 2 },
  );

  await pushDatabase.prepare(`UPDATE push_deliveries
    SET status = 'pending', status_code = NULL, attempt_count = 0,
      next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE game_id = ? AND game_version = 3`)
    .bind(new Date().toISOString(), guestGameId)
    .run();
  forcedPushStatuses.push(410);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 4), true);
  assert.equal(
    (await pushDatabase.prepare(`SELECT status FROM push_deliveries
      WHERE game_id = ? AND game_version = 3`)
      .bind(guestGameId)
      .first()).status,
    "stale",
  );
  const rejectedLegacyStale = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      method: "PUT",
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: guestPushSubscription,
      }),
    },
  );
  assert.equal(rejectedLegacyStale.status, 409);
  assert.equal((await body(rejectedLegacyStale)).error.code, "stale_subscription");
  const freshLegacySubscription = {
    ...guestPushSubscription,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      method: "PUT",
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: freshLegacySubscription,
      }),
    },
  )).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT status FROM push_deliveries
      WHERE game_id = ? AND game_version = 3`)
      .bind(guestGameId)
      .first()).status,
    "stale",
    "a fresh legacy registration must preserve the stale delivery audit row",
  );
  outboundPushRequests.splice(3, 1);

  const disableGuestPush = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${guestBlackToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        endpoint: guestPushEndpoint,
      }),
    },
  );
  assert.equal(disableGuestPush.status, 200);
  const disableRetriedWhitePush = await request(
    runtime,
    `/api/games/${guestGameId}/push-subscriptions`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${guestWhiteToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        endpoint: guestPushEndpoint,
      }),
    },
  );
  assert.equal(disableRetriedWhitePush.status, 200);
  assert.equal(
    (await pushDatabase
      .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
      .first()).count,
    0,
  );

  const accountPushWhiteToken = secret();
  const accountPushBlackToken = secret();
  const accountPushInviteToken = secret();
  const accountPushCreate = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    body: JSON.stringify({
      displayName: "Guest White",
      mode: "multiplayer",
      playerToken: accountPushWhiteToken,
      inviteToken: accountPushInviteToken,
      requestId: randomUUID(),
    }),
  });
  assert.equal(accountPushCreate.status, 201);
  const accountPushGame = await body(accountPushCreate);
  const accountPushGameId = accountPushGame.game.id;
  const accountPushJoin = await request(
    runtime,
    `/api/invitations/${accountPushInviteToken}/join`,
    {
      method: "POST",
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
      body: JSON.stringify({
        displayName: "Guest Black",
        playerToken: accountPushBlackToken,
      }),
    },
  );
  assert.equal(accountPushJoin.status, 200);

  const legacyBeforeUpgrade = await request(
    runtime,
    `/api/games/${accountPushGameId}/push-subscriptions`,
    {
      method: "PUT",
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
      headers: { authorization: `Bearer ${accountPushBlackToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: guestPushSubscription,
      }),
    },
  );
  assert.equal(legacyBeforeUpgrade.status, 200);
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash)
      .first()).count,
    1,
  );

  const pushOwnerUsername = usernameForAccount(accountForLabel("Guest Black"));
  const rejectedWrongOwner = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: usernameForAccount(accountForLabel("Guest White")),
      subscription: guestPushSubscription,
    }),
  });
  assert.equal(rejectedWrongOwner.status, 409);
  assert.equal((await body(rejectedWrongOwner)).error.code, "account_changed");
  const rejectedMissingOwner = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({ requestId: randomUUID(), subscription: guestPushSubscription }),
  });
  assert.equal(rejectedMissingOwner.status, 400);
  assert.equal((await body(rejectedMissingOwner)).error.code, "expected_username_required");
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash).first()).count,
    0,
    "rejected owner-bound writes must not register a device",
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash).first()).count,
    1,
    "rejected owner-bound writes must preserve legacy consent",
  );

  const accountDeviceEnable = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: guestPushSubscription,
    }),
  });
  assert.equal(accountDeviceEnable.status, 200);
  assert.deepEqual(await body(accountDeviceEnable), { enabled: true });
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count FROM push_subscriptions
      WHERE endpoint_hash = ? AND disabled_at IS NULL`)
      .bind(guestPushEndpointHash)
      .first()).count,
    0,
    "explicit account consent must replace the same device's narrow legacy grants",
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash)
      .first()).count,
    1,
    "scope upgrades retain the disabled legacy parent for delivery audit history",
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash)
      .first()).count,
    1,
  );
  assert.deepEqual(await body(await request(runtime, "/api/me/push-devices", {
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    headers: { "x-push-endpoint-hash": guestPushEndpointHash },
  })), { available: true, enabled: true, owned: true, legacy: false, stale: false });
  assert.deepEqual(await body(await request(runtime, "/api/me/push-devices", {
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    headers: { "x-push-endpoint-hash": guestPushEndpointHash },
  })), { available: true, enabled: false, owned: false, legacy: false, stale: false });

  assert.equal((await request(
    runtime,
    `/api/games/${accountPushGameId}/push-subscriptions`,
    {
      method: "PUT",
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
      headers: { authorization: `Bearer ${accountPushBlackToken}` },
      body: JSON.stringify({ requestId: randomUUID(), subscription: guestPushSubscription }),
    },
  )).status, 200);
  const preserveLegacy = await request(runtime, "/api/me/push-devices", {
    method: "DELETE",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      endpoint: guestPushEndpoint,
      expectedUsername: pushOwnerUsername,
      preserveLegacy: true,
    }),
  });
  assert.equal(preserveLegacy.status, 200);
  assert.deepEqual(await body(await request(runtime, "/api/me/push-devices", {
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    headers: { "x-push-endpoint-hash": guestPushEndpointHash },
  })), { available: true, enabled: false, owned: true, legacy: true, stale: false });
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: guestPushSubscription,
    }),
  })).status, 200);

  const accountPushWhiteGame = await body(await request(
    runtime,
    `/api/games/${accountPushGameId}`,
    {
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
      headers: { authorization: `Bearer ${accountPushWhiteToken}` },
    },
  ));
  const accountPushMoveBody = JSON.stringify({
    from: "e2",
    to: "e4",
    expectedVersion: accountPushWhiteGame.game.version,
    requestId: randomUUID(),
  });
  const accountPushMove = await request(
    runtime,
    `/api/games/${accountPushGameId}/moves`,
    {
      method: "POST",
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
      headers: { authorization: `Bearer ${accountPushWhiteToken}` },
      body: accountPushMoveBody,
    },
  );
  assert.equal(accountPushMove.status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 4), true);
  assert.equal(outboundPushRequests[3].url, guestPushEndpoint);
  assert.deepEqual(
    await pushDatabase.prepare(`SELECT status, attempt_count
      FROM push_turn_deliveries WHERE game_id = ?`)
      .bind(accountPushGameId)
      .first(),
    { status: "sent", attempt_count: 1 },
  );
  const accountPushMoveRetry = await request(
    runtime,
    `/api/games/${accountPushGameId}/moves`,
    {
      method: "POST",
      accountEmail: accountForLabel("Guest White").email,
      accountName: "Guest White",
      headers: { authorization: `Bearer ${accountPushWhiteToken}` },
      body: accountPushMoveBody,
    },
  );
  assert.equal(accountPushMoveRetry.status, 200);
  assert.equal(outboundPushRequests.length, 4);

  const accountPushUpdatedAt = (await pushDatabase
    .prepare("SELECT updated_at FROM games WHERE id = ?")
    .bind(accountPushGameId)
    .first()).updated_at;
  await pushDatabase.prepare(`UPDATE push_turn_deliveries
    SET status = 'pending', status_code = NULL, attempt_count = 0,
        next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE game_id = ?`)
    .bind(new Date().toISOString(), accountPushGameId)
    .run();
  await pushDatabase
    .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
    .bind(
      new Date(Date.now() - 3 * 24 * 60 * 60_000 - 5_000).toISOString(),
      accountPushGameId,
    )
    .run();
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare(`SELECT status FROM push_turn_deliveries
      WHERE game_id = ?`)
      .bind(accountPushGameId)
      .first()
  )?.status === "superseded"), true);
  assert.equal(outboundPushRequests.length, 4, "an expired turn must not send a push");
  await pushDatabase
    .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
    .bind(accountPushUpdatedAt, accountPushGameId)
    .run();

  await pushDatabase.prepare(`UPDATE push_turn_deliveries
    SET status = 'pending', status_code = NULL, attempt_count = 0,
        next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE game_id = ?`)
    .bind(new Date().toISOString(), accountPushGameId)
    .run();
  forcedPushStatuses.push(410);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 5), true);
  assert.deepEqual(
    await pushDatabase.prepare(`SELECT status, status_code, attempt_count
      FROM push_turn_deliveries WHERE game_id = ?`)
      .bind(accountPushGameId)
      .first(),
    { status: "stale", status_code: 410, attempt_count: 1 },
    "a stale provider response must not cascade-delete its delivery audit row",
  );
  assert.notEqual(
    (await pushDatabase.prepare(`SELECT disabled_at FROM push_devices
      WHERE endpoint_hash = ?`)
      .bind(guestPushEndpointHash)
      .first()).disabled_at,
    null,
  );
  outboundPushRequests.splice(4, 1);
  assert.deepEqual(await body(await request(runtime, "/api/me/push-devices", {
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    headers: { "x-push-endpoint-hash": guestPushEndpointHash },
  })), { available: true, enabled: false, owned: false, legacy: false, stale: true });
  assert.deepEqual(await body(await request(runtime, "/api/me/push-devices", {
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    headers: { "x-push-endpoint-hash": guestPushEndpointHash },
  })), { available: true, enabled: false, owned: false, legacy: false, stale: true });
  const rejectedCrossAccountStale = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: usernameForAccount(accountForLabel("Guest White")),
      subscription: guestPushSubscription,
    }),
  });
  assert.equal(rejectedCrossAccountStale.status, 409);
  assert.equal((await body(rejectedCrossAccountStale)).error.code, "stale_subscription");
  const rejectedStaleRegistration = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: guestPushSubscription,
    }),
  });
  assert.equal(rejectedStaleRegistration.status, 409);
  assert.equal((await body(rejectedStaleRegistration)).error.code, "stale_subscription");
  const rotatedGuestPushSubscription = {
    ...guestPushSubscription,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: rotatedGuestPushSubscription,
    }),
  })).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT status FROM push_turn_deliveries
      WHERE game_id = ?`)
      .bind(accountPushGameId)
      .first()).status,
    "stale",
    "rotating a provider-stale device must retain its delivery audit row",
  );

  await pushDatabase.prepare(`UPDATE push_turn_deliveries
    SET status = 'pending', attempt_count = 6, next_attempt_at = 0,
        lease_token = ?, lease_until = ?, updated_at = ?
    WHERE game_id = ?`)
    .bind(randomUUID(), Date.now() - 1, new Date().toISOString(), accountPushGameId)
    .run();
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare(`SELECT status FROM push_turn_deliveries
      WHERE game_id = ?`)
      .bind(accountPushGameId)
      .first()
  )?.status === "dead"), true);
  assert.equal(outboundPushRequests.length, 4, "an exhausted row must die without another send");

  const primaryPushDevice = await pushDatabase.prepare(`SELECT id, account_id
    FROM push_devices WHERE endpoint_hash = ?`)
    .bind(guestPushEndpointHash)
    .first();
  assert.ok(primaryPushDevice?.id);
  const capDevices = [];
  for (let index = 0; index < 5; index += 1) {
    const endpoint = `https://fcm.googleapis.com/fcm/send/cap-${secret()}`;
    const endpointHash = createHash("sha256").update(endpoint).digest("hex");
    const id = randomUUID();
    const createdAt = new Date(Date.now() - (10 - index) * 1_000).toISOString();
    await pushDatabase.prepare(`INSERT INTO push_devices (
      id, account_id, endpoint_hash, endpoint, p256dh, auth, expiration_time,
      created_at, updated_at, last_success_at, failure_count, disabled_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, NULL)`)
      .bind(
        id,
        primaryPushDevice.account_id,
        endpointHash,
        endpoint,
        vapidPublicKey,
        randomBytes(16).toString("base64url"),
        createdAt,
        createdAt,
      )
      .run();
    capDevices.push({ id, endpoint, endpointHash });
  }
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count FROM push_devices
      WHERE account_id = ? AND disabled_at IS NULL`)
      .bind(primaryPushDevice.account_id)
      .first()).count,
    6,
  );

  const capEvictedDeliveryId = randomUUID();
  const capEvictionAt = new Date().toISOString();
  await pushDatabase.prepare(`INSERT INTO push_turn_deliveries (
    id, device_id, game_id, game_version, kind, status, status_code,
    attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`)
    .bind(
      capEvictedDeliveryId,
      capDevices[0].id,
      accountPushGameId,
      accountPushWhiteGame.game.version + 1,
      capEvictionAt,
      capEvictionAt,
    )
    .run();
  const seventhCapSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/cap-seventh-${secret()}`,
    expirationTime: null,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: seventhCapSubscription,
    }),
  })).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count FROM push_devices
      WHERE account_id = ? AND disabled_at IS NULL`)
      .bind(primaryPushDevice.account_id)
      .first()).count,
    6,
  );
  assert.notEqual(
    (await pushDatabase.prepare("SELECT disabled_at FROM push_devices WHERE id = ?")
      .bind(capDevices[0].id)
      .first()).disabled_at,
    null,
    "the active-device cap must soft-disable its oldest target",
  );
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare("SELECT status FROM push_turn_deliveries WHERE id = ?")
      .bind(capEvictedDeliveryId)
      .first()
  )?.status === "dead"), true);
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_turn_deliveries WHERE id = ?")
      .bind(capEvictedDeliveryId)
      .first()).count,
    1,
    "cap eviction must retain its terminal delivery audit row",
  );
  assert.equal(outboundPushRequests.length, 4, "an evicted target must not reach the provider");

  const legacyCapTargets = [];
  for (let index = 0; index < 6; index += 1) {
    const endpoint = `https://fcm.googleapis.com/fcm/send/legacy-cap-${secret()}`;
    const id = randomUUID();
    const createdAt = new Date(Date.now() - (20 - index) * 1_000).toISOString();
    await pushDatabase.prepare(`INSERT INTO push_subscriptions (
      id, game_id, color, account_id, endpoint_hash, endpoint, p256dh, auth,
      expiration_time, created_at, updated_at, last_success_at, failure_count, disabled_at
    ) VALUES (?, ?, 'b', ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, NULL)`)
      .bind(
        id,
        accountPushGameId,
        primaryPushDevice.account_id,
        createHash("sha256").update(endpoint).digest("hex"),
        endpoint,
        vapidPublicKey,
        randomBytes(16).toString("base64url"),
        createdAt,
        createdAt,
      )
      .run();
    legacyCapTargets.push({ id, endpoint });
  }
  const legacyCapDeliveryId = randomUUID();
  const legacyCapAt = new Date().toISOString();
  await pushDatabase.prepare(`INSERT INTO push_deliveries (
    id, subscription_id, game_id, game_version, kind, status, status_code,
    attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`)
    .bind(
      legacyCapDeliveryId,
      legacyCapTargets[0].id,
      accountPushGameId,
      accountPushWhiteGame.game.version + 1,
      legacyCapAt,
      legacyCapAt,
    )
    .run();
  const seventhLegacyCapSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/legacy-cap-${secret()}`,
    expirationTime: null,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(
    runtime,
    `/api/games/${accountPushGameId}/push-subscriptions`,
    {
      method: "PUT",
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
      headers: { authorization: `Bearer ${accountPushBlackToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        subscription: seventhLegacyCapSubscription,
      }),
    },
  )).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count FROM push_subscriptions
      WHERE game_id = ? AND color = 'b' AND account_id = ? AND disabled_at IS NULL`)
      .bind(accountPushGameId, primaryPushDevice.account_id)
      .first()).count,
    6,
  );
  assert.notEqual(
    (await pushDatabase.prepare("SELECT disabled_at FROM push_subscriptions WHERE id = ?")
      .bind(legacyCapTargets[0].id)
      .first()).disabled_at,
    null,
    "the per-seat cap must soft-disable its oldest target",
  );
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare("SELECT status FROM push_deliveries WHERE id = ?")
      .bind(legacyCapDeliveryId)
      .first()
  )?.status === "dead"), true);
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_deliveries WHERE id = ?")
      .bind(legacyCapDeliveryId)
      .first()).count,
    1,
    "legacy cap eviction must retain its terminal delivery audit row",
  );
  assert.equal(outboundPushRequests.length, 4, "an evicted legacy target must not reach the provider");
  await pushDatabase.prepare(`DELETE FROM push_subscriptions
    WHERE game_id = ? AND endpoint LIKE 'https://fcm.googleapis.com/fcm/send/legacy-cap-%'`)
    .bind(accountPushGameId)
    .run();

  const fairnessLegacyEndpoint = `https://fcm.googleapis.com/fcm/send/fair-${secret()}`;
  const fairnessLegacyId = randomUUID();
  const fairnessLegacyDeliveryId = randomUUID();
  const capDeliveryId = randomUUID();
  const fairnessOldAt = new Date(Date.now() - 2_000).toISOString();
  const fairnessNewAt = new Date(Date.now() - 1_000).toISOString();
  await pushDatabase.prepare(`INSERT INTO push_subscriptions (
    id, game_id, color, account_id, endpoint_hash, endpoint, p256dh, auth,
    expiration_time, created_at, updated_at, last_success_at, failure_count, disabled_at
  ) VALUES (?, ?, 'b', ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, NULL)`)
    .bind(
      fairnessLegacyId,
      accountPushGameId,
      primaryPushDevice.account_id,
      createHash("sha256").update(fairnessLegacyEndpoint).digest("hex"),
      fairnessLegacyEndpoint,
      vapidPublicKey,
      randomBytes(16).toString("base64url"),
      fairnessOldAt,
      fairnessOldAt,
    )
    .run();
  await pushDatabase.batch([
    pushDatabase.prepare(`INSERT INTO push_deliveries (
      id, subscription_id, game_id, game_version, kind, status, status_code,
      attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`)
      .bind(
        fairnessLegacyDeliveryId,
        fairnessLegacyId,
        accountPushGameId,
        accountPushWhiteGame.game.version + 1,
        fairnessOldAt,
        fairnessOldAt,
      ),
    pushDatabase.prepare(`INSERT INTO push_turn_deliveries (
      id, device_id, game_id, game_version, kind, status, status_code,
      attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`)
      .bind(
        capDeliveryId,
        capDevices[4].id,
        accountPushGameId,
        accountPushWhiteGame.game.version + 1,
        fairnessNewAt,
        fairnessNewAt,
      ),
  ]);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 6), true);
  assert.equal(
    outboundPushRequests[4].url,
    fairnessLegacyEndpoint,
    "globally older legacy work must not be starved by the account lane",
  );
  assert.equal(outboundPushRequests[5].url, capDevices[4].endpoint);
  await pushDatabase.prepare("DELETE FROM push_subscriptions WHERE id = ?")
    .bind(fairnessLegacyId)
    .run();

  await pushDatabase.prepare(`UPDATE push_turn_deliveries
    SET status = 'pending', status_code = NULL, attempt_count = 0,
      next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ?`)
    .bind(new Date().toISOString(), capDeliveryId)
    .run();
  forcedPushStatuses.push(410);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 7), true);
  assert.equal(
    (await pushDatabase.prepare("SELECT status FROM push_turn_deliveries WHERE id = ?")
      .bind(capDeliveryId)
      .first()).status,
    "stale",
  );

  const rotatedCapSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/cap-rotated-${secret()}`,
    expirationTime: null,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushOwnerUsername,
      subscription: rotatedCapSubscription,
    }),
  })).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count FROM push_devices
      WHERE account_id = ? AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)`)
      .bind(primaryPushDevice.account_id, Date.now())
      .first()).count,
    6,
    "retained stale parents must not consume an active device slot",
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE account_id = ?")
      .bind(primaryPushDevice.account_id)
      .first()).count,
    8,
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_turn_deliveries WHERE id = ?")
      .bind(capDeliveryId)
      .first()).count,
    1,
  );
  await pushDatabase.prepare(`DELETE FROM push_devices
    WHERE account_id = ? AND id <> ? AND disabled_at IS NULL`)
    .bind(primaryPushDevice.account_id, primaryPushDevice.id)
    .run();

  const expiredAuditAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString();
  const retentionSentinelId = randomUUID();
  const retentionSentinelEndpoint = `https://fcm.googleapis.com/fcm/send/retention-${secret()}`;
  await pushDatabase.batch([
    pushDatabase.prepare(`UPDATE push_devices
      SET disabled_at = ?, updated_at = ? WHERE id = ?`)
      .bind(expiredAuditAt, expiredAuditAt, capDevices[4].id),
    pushDatabase.prepare(`INSERT INTO push_devices (
      id, account_id, endpoint_hash, endpoint, p256dh, auth, expiration_time,
      created_at, updated_at, last_success_at, failure_count, disabled_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1, ?)`)
      .bind(
        retentionSentinelId,
        primaryPushDevice.account_id,
        createHash("sha256").update(retentionSentinelEndpoint).digest("hex"),
        retentionSentinelEndpoint,
        vapidPublicKey,
        randomBytes(16).toString("base64url"),
        expiredAuditAt,
        expiredAuditAt,
        expiredAuditAt,
      ),
  ]);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE id = ?")
      .bind(retentionSentinelId)
      .first()
  ).count === 0), true);
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE id = ?")
      .bind(capDevices[4].id)
      .first()).count,
    1,
    "a recent audit row must protect its stale parent during retention",
  );
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_turn_deliveries WHERE id = ?")
      .bind(capDeliveryId)
      .first()).count,
    1,
  );
  await pushDatabase.prepare(`UPDATE push_turn_deliveries
    SET created_at = ?, updated_at = ? WHERE id = ?`)
    .bind(expiredAuditAt, expiredAuditAt, capDeliveryId)
    .run();
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(async () => {
    const delivery = await pushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries WHERE id = ?`)
      .bind(capDeliveryId)
      .first();
    const device = await pushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_devices WHERE id = ?`)
      .bind(capDevices[4].id)
      .first();
    return delivery.count === 0 && device.count === 0;
  }), true, "the 30-day sweep removes the audit row before its retained stale parent");
  outboundPushRequests.splice(4, 3);

  const parallelWhiteToken = secret();
  const parallelBlackToken = secret();
  const parallelInviteToken = secret();
  const parallelCreate = await body(await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    body: JSON.stringify({
      displayName: "Guest White",
      mode: "multiplayer",
      playerToken: parallelWhiteToken,
      inviteToken: parallelInviteToken,
      requestId: randomUUID(),
    }),
  }));
  assert.equal((await request(runtime, `/api/invitations/${parallelInviteToken}/join`, {
    method: "POST",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      displayName: "Guest Black",
      playerToken: parallelBlackToken,
    }),
  })).status, 200);
  const parallelWhiteGame = await body(await request(runtime, `/api/games/${parallelCreate.game.id}`, {
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    headers: { authorization: `Bearer ${parallelWhiteToken}` },
  }));
  assert.equal((await request(runtime, `/api/games/${parallelCreate.game.id}/moves`, {
    method: "POST",
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    headers: { authorization: `Bearer ${parallelWhiteToken}` },
    body: JSON.stringify({
      from: "e2",
      to: "e4",
      expectedVersion: parallelWhiteGame.game.version,
      requestId: randomUUID(),
    }),
  })).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 5), true);
  assert.equal(
    (await pushDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries
      WHERE device_id = ? AND game_version = ? AND game_id IN (?, ?)`)
      .bind(
        primaryPushDevice.id,
        accountPushWhiteGame.game.version + 1,
        accountPushGameId,
        parallelCreate.game.id,
      )
      .first()).count,
    2,
    "one account device must keep distinct deliveries for two games at the same version",
  );

  const pushTargetUsername = usernameForAccount(accountForLabel("Guest Black"));
  const inspectPush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({
      scope: "push-notifications:manage",
      targetUsername: pushTargetUsername,
      pushAction: "inspect",
    }),
  });
  assert.equal(inspectPush.status, 200);
  const inspectedPush = await body(inspectPush);
  assert.equal(inspectedPush.username, pushTargetUsername);
  assert.equal(inspectedPush.activeSubscriptions, 1);
  assert.ok(Number.isFinite(Date.parse(inspectedPush.lastAcceptedAt)));
  const invalidServicePush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({
      scope: "push-notifications:manage",
      targetUsername: pushTargetUsername,
      pushAction: "send",
      pushMessage: "line one\nline two",
    }),
  });
  assert.equal(invalidServicePush.status, 400);
  assert.equal((await body(invalidServicePush)).error, "invalid_push_action");
  const spoofedServicePush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({
      scope: "push-notifications:manage",
      targetUsername: pushTargetUsername,
      pushAction: "send",
      pushMessage: "spoof\u202eexe",
    }),
  });
  assert.equal(spoofedServicePush.status, 400);
  assert.equal((await body(spoofedServicePush)).error, "invalid_push_action");
  assert.equal(outboundPushRequests.length, 5);
  assert.equal((await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://evil.example" },
    body: opsGrant({
      scope: "push-notifications:manage",
      targetUsername: pushTargetUsername,
      pushAction: "inspect",
    }),
  })).status, 403);

  const servicePushGrant = opsGrant({
    scope: "push-notifications:manage",
    targetUsername: pushTargetUsername,
    pushAction: "send",
    pushMessage: "Your ChessRiot notification test is working.",
  });
  const servicePush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: servicePushGrant,
  });
  assert.equal(servicePush.status, 200);
  assert.deepEqual(await body(servicePush), {
    ok: true,
    username: pushTargetUsername,
    active: 1,
    accepted: 1,
    stale: 0,
    failed: 0,
    providerAuth: 0,
    retryable: 0,
    endpointRejected: 0,
  });
  assert.equal(outboundPushRequests.length, 6);
  assert.equal(outboundPushRequests[5].ttl, "600");
  assert.equal(outboundPushRequests[5].urgency, "high");
  assert.match(outboundPushRequests[5].topic ?? "", /^service-[A-Za-z0-9_-]{24}$/);
  await pushDatabase.prepare("DELETE FROM push_devices WHERE endpoint_hash = ?")
    .bind(guestPushEndpointHash)
    .run();
  const replayedServicePush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: servicePushGrant,
  });
  assert.equal(replayedServicePush.status, 200);
  assert.deepEqual(await body(replayedServicePush), {
    ok: true,
    username: pushTargetUsername,
    active: 1,
    accepted: 1,
    stale: 0,
    failed: 0,
    providerAuth: 0,
    retryable: 0,
    endpointRejected: 0,
  });
  assert.equal(outboundPushRequests.length, 6);

  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushTargetUsername,
      subscription: rotatedGuestPushSubscription,
    }),
  })).status, 200);
  forcedPushStatuses.push(401);
  const rejectedCredentialPush = await request(runtime, "/api/ops/push-notifications", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({
      scope: "push-notifications:manage",
      targetUsername: pushTargetUsername,
      pushAction: "send",
      pushMessage: "Check push configuration.",
    }),
  });
  assert.equal(rejectedCredentialPush.status, 200);
  assert.deepEqual(await body(rejectedCredentialPush), {
    ok: true,
    username: pushTargetUsername,
    active: 1,
    accepted: 0,
    stale: 0,
    failed: 1,
    providerAuth: 1,
    retryable: 0,
    endpointRejected: 0,
  });
  assert.equal(outboundPushRequests.length, 7);

  const wrongOwnerSelfTest = await request(runtime, "/api/me/push-devices/test", {
    method: "POST",
    accountEmail: accountForLabel("Guest White").email,
    accountName: "Guest White",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: usernameForAccount(accountForLabel("Guest White")),
      endpoint: guestPushEndpoint,
    }),
  });
  assert.equal(wrongOwnerSelfTest.status, 409);
  assert.equal((await body(wrongOwnerSelfTest)).error.code, "device_not_registered");
  assert.equal(outboundPushRequests.length, 7);

  const deviceSelfTest = await request(runtime, "/api/me/push-devices/test", {
    method: "POST",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushTargetUsername,
      endpoint: guestPushEndpoint,
    }),
  });
  assert.equal(deviceSelfTest.status, 200);
  assert.deepEqual(await body(deviceSelfTest), { outcome: "accepted" });
  assert.equal(outboundPushRequests.length, 8);
  assert.equal(outboundPushRequests[7].ttl, "300");
  assert.equal(outboundPushRequests[7].urgency, "high");

  const pushFriendSender = {
    email: "push-friend-sender@players.chessriot.test",
    displayName: "Push Friend Sender",
  };
  forcedPushStatuses.push(503, 503, 201);
  const pushedFriendRequest = await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: pushFriendSender.email,
    accountName: pushFriendSender.displayName,
    body: JSON.stringify({ username: pushTargetUsername }),
  });
  assert.equal(pushedFriendRequest.status, 201);
  const pushedFriendRequestBody = await body(pushedFriendRequest);
  assert.equal(typeof pushedFriendRequestBody.requestId, "string");
  assert.equal(pushedFriendRequestBody.pushNotification, undefined);
  assert.equal(await waitFor(() => outboundPushRequests.length === 11, 23_000), true);
  assert.equal(outboundPushRequests[8].ttl, "86400");
  assert.equal(outboundPushRequests[9].ttl, "86400");
  assert.equal(outboundPushRequests[10].ttl, "86400");
  assert.deepEqual(
    await pushDatabase.prepare(`SELECT status, attempt_count
      FROM push_account_deliveries WHERE friend_request_id = ?`)
      .bind(pushedFriendRequestBody.requestId)
      .first(),
    { status: "sent", attempt_count: 3 },
  );
  const duplicateFriendRequest = await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: pushFriendSender.email,
    accountName: pushFriendSender.displayName,
    body: JSON.stringify({ username: pushTargetUsername }),
  });
  assert.equal(duplicateFriendRequest.status, 201);
  assert.equal(outboundPushRequests.length, 11, "a duplicate pending request must not resend push");
  assert.equal((await request(
    runtime,
    `/api/me/friend-requests/${pushedFriendRequestBody.requestId}`,
    {
      method: "DELETE",
      accountEmail: pushFriendSender.email,
      accountName: pushFriendSender.displayName,
    },
  )).status, 200);
  const rapidResend = await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: pushFriendSender.email,
    accountName: pushFriendSender.displayName,
    body: JSON.stringify({ username: pushTargetUsername }),
  });
  assert.equal(rapidResend.status, 201);
  assert.equal((await body(rapidResend)).requestId, pushedFriendRequestBody.requestId);
  assert.equal(outboundPushRequests.length, 11, "cancel and rapid resend must not stack alerts");

  const concurrentDevice = await pushDatabase.prepare(`SELECT id FROM push_devices
    WHERE endpoint_hash = ? AND disabled_at IS NULL`)
    .bind(guestPushEndpointHash)
    .first();
  assert.ok(concurrentDevice?.id);
  const concurrentTurnDeliveryId = randomUUID();
  const concurrentAt = new Date().toISOString();
  await pushDatabase.batch([
    pushDatabase.prepare(`INSERT INTO push_turn_deliveries (
      id, device_id, game_id, game_version, kind, status, status_code,
      attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`)
      .bind(
        concurrentTurnDeliveryId,
        concurrentDevice.id,
        accountPushGameId,
        accountPushWhiteGame.game.version + 1,
        concurrentAt,
        concurrentAt,
      ),
    pushDatabase.prepare(`UPDATE push_account_deliveries
      SET status = 'pending', status_code = NULL, attempt_count = 0,
          next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
      WHERE friend_request_id = ?`)
      .bind(concurrentAt, pushedFriendRequestBody.requestId),
  ]);
  let releaseAcceptedResponse = () => {};
  const acceptedAfterStale = new Promise((resolve) => {
    releaseAcceptedResponse = () => resolve(new Response(null, { status: 201 }));
  });
  forcedPushResponders.push(
    () => acceptedAfterStale,
    async () => new Response(null, { status: 410 }),
  );
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 13), true);
  assert.equal(await waitFor(async () => (
    await pushDatabase.prepare("SELECT disabled_at FROM push_devices WHERE id = ?")
      .bind(concurrentDevice.id)
      .first()
  )?.disabled_at !== null), true);
  releaseAcceptedResponse();
  assert.equal(await waitFor(async () => {
    const turn = await pushDatabase.prepare("SELECT status FROM push_turn_deliveries WHERE id = ?")
      .bind(concurrentTurnDeliveryId)
      .first();
    const account = await pushDatabase.prepare(`SELECT status FROM push_account_deliveries
      WHERE friend_request_id = ?`)
      .bind(pushedFriendRequestBody.requestId)
      .first();
    return [turn?.status, account?.status].every((status) => ["sent", "stale"].includes(status));
  }), true);
  const concurrentOutcomes = [
    (await pushDatabase.prepare("SELECT status FROM push_turn_deliveries WHERE id = ?")
      .bind(concurrentTurnDeliveryId)
      .first()).status,
    (await pushDatabase.prepare(`SELECT status FROM push_account_deliveries
      WHERE friend_request_id = ?`)
      .bind(pushedFriendRequestBody.requestId)
      .first()).status,
  ].sort();
  assert.deepEqual(concurrentOutcomes, ["sent", "stale"]);
  assert.notEqual(
    (await pushDatabase.prepare("SELECT disabled_at FROM push_devices WHERE id = ?")
      .bind(concurrentDevice.id)
      .first()).disabled_at,
    null,
    "a concurrent provider success must not resurrect credentials rejected as stale",
  );
  const concurrentRecoverySubscription = {
    ...guestPushSubscription,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushTargetUsername,
      subscription: concurrentRecoverySubscription,
    }),
  })).status, 200);

  await pushDatabase.prepare(`UPDATE push_account_deliveries
    SET status = 'pending', status_code = NULL, attempt_count = 0,
        next_attempt_at = 0, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE friend_request_id = ?`)
    .bind(new Date().toISOString(), pushedFriendRequestBody.requestId)
    .run();
  forcedPushStatuses.push(410);
  assert.equal((await request(runtime, "/api/push/config")).status, 200);
  assert.equal(await waitFor(() => outboundPushRequests.length === 14), true);
  assert.deepEqual(
    await pushDatabase.prepare(`SELECT status, attempt_count
      FROM push_account_deliveries WHERE friend_request_id = ?`)
      .bind(pushedFriendRequestBody.requestId)
      .first(),
    { status: "stale", attempt_count: 1 },
    "a stale friend push must retain its delivery row",
  );
  const rejectedFriendStaleRegistration = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushTargetUsername,
      subscription: concurrentRecoverySubscription,
    }),
  });
  assert.equal(rejectedFriendStaleRegistration.status, 409);
  assert.equal((await body(rejectedFriendStaleRegistration)).error.code, "stale_subscription");
  const friendRotatedPushSubscription = {
    ...guestPushSubscription,
    keys: {
      p256dh: vapidPublicKey,
      auth: randomBytes(16).toString("base64url"),
    },
  };
  assert.equal((await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: pushTargetUsername,
      subscription: friendRotatedPushSubscription,
    }),
  })).status, 200);
  assert.equal(
    (await pushDatabase.prepare(`SELECT status FROM push_account_deliveries
      WHERE friend_request_id = ?`)
      .bind(pushedFriendRequestBody.requestId)
      .first()).status,
    "stale",
    "rotating a provider-stale friend device must retain its delivery audit row",
  );

  let pushEnableRateLimited = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const repeatedEnable = await request(runtime, "/api/me/push-devices", {
      method: "PUT",
      accountEmail: accountForLabel("Guest Black").email,
      accountName: "Guest Black",
      body: JSON.stringify({
        requestId: randomUUID(),
        expectedUsername: pushTargetUsername,
        subscription: guestPushSubscription,
      }),
    });
    if (repeatedEnable.status === 429) {
      pushEnableRateLimited = true;
      break;
    }
  }
  assert.equal(pushEnableRateLimited, true);
  const revokeAfterQuota = await request(runtime, "/api/me/push-devices", {
    method: "DELETE",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({ requestId: randomUUID(), endpoint: guestPushEndpoint }),
  });
  assert.equal(revokeAfterQuota.status, 200, "notification revocation must never be rate limited");
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash)
      .first()).count,
    0,
  );

  const detachOnSignout = await request(runtime, "/api/auth/signout", {
    method: "POST",
    accountEmail: accountForLabel("Guest Black").email,
    accountName: "Guest Black",
    body: JSON.stringify({ endpoint: guestPushEndpoint }),
  });
  assert.equal(detachOnSignout.status, 200);
  assert.equal(
    (await pushDatabase.prepare("SELECT COUNT(*) AS count FROM push_devices WHERE endpoint_hash = ?")
      .bind(guestPushEndpointHash)
      .first()).count,
    0,
  );

  const invalidVariantResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Invalid Variant Player",
      mode: "multiplayer",
      variantId: "only-pawns",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(invalidVariantResponse.status, 400);
  assert.equal((await body(invalidVariantResponse)).error.code, "invalid_variant");

  const multiplayerMatingSet = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Multiplayer Mating Set",
      mode: "multiplayer",
      variantId: "mate-rook",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(multiplayerMatingSet.status, 422);
  assert.equal((await body(multiplayerMatingSet)).error.code, "variant_mode_conflict");

  const matingSetToken = secret();
  const matingSetCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Mating Set Learner",
      mode: "solo",
      variantId: "mate-pawn",
      difficulty: 2,
      playerToken: matingSetToken,
      inviteToken: secret(),
      requestId: requestIdForColor("b"),
    }),
  });
  assert.equal(matingSetCreatedResponse.status, 201);
  const matingSetCreated = await body(matingSetCreatedResponse);
  assert.equal(matingSetCreated.inviteUrl, undefined);
  assert.equal(matingSetCreated.game.variantId, "mate-pawn");
  assert.equal(matingSetCreated.game.mode, "solo");
  assert.equal(matingSetCreated.game.initialFen, "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1");
  assert.equal(matingSetCreated.game.you.color, "w");
  assert.equal(matingSetCreated.game.players.black.name, "Riot Bot");
  assert.equal(matingSetCreated.game.version, 0);
  const matingSetMoveResponse = await request(
    runtime,
    `/api/games/${matingSetCreated.game.id}/moves`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${matingSetToken}` },
      body: JSON.stringify({
        from: "e6",
        to: "d6",
        expectedVersion: 0,
        requestId: randomUUID(),
      }),
    },
  );
  assert.equal(matingSetMoveResponse.status, 200);
  const matingSetAfterMove = await body(matingSetMoveResponse);
  assert.equal(matingSetAfterMove.game.variantId, "mate-pawn");
  assert.equal(matingSetAfterMove.game.version, 2);
  assert.deepEqual(
    matingSetAfterMove.game.moves.map((move) => move.color),
    ["w", "b"],
  );

  const halfArmyFen = "rnb1k3/pppp4/8/8/8/8/PPPP4/RNB1K3 w - - 0 1";
  const halfArmyWhiteToken = secret();
  const halfArmyBlackToken = secret();
  const halfArmyInvite = secret();
  const halfArmyCreateId = randomUUID();
  const halfArmyCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Half Army White",
      mode: "multiplayer",
      variantId: "half-army",
      turnPaceDays: 1,
      playerToken: halfArmyWhiteToken,
      inviteToken: halfArmyInvite,
      requestId: halfArmyCreateId,
    }),
  });
  assert.equal(halfArmyCreatedResponse.status, 201);
  const halfArmyCreated = await body(halfArmyCreatedResponse);
  assert.equal(halfArmyCreated.game.variantId, "half-army");
  assert.equal(halfArmyCreated.game.initialFen, halfArmyFen);
  assert.equal(halfArmyCreated.game.fen, halfArmyFen);
  assert.equal(halfArmyCreated.game.turnPaceDays, 1);

  assert.equal((await request(
    runtime,
    `/api/invitations/${halfArmyInvite}`,
    { anonymous: true },
  )).status, 401);
  const halfArmyInvitePreview = await body(await request(
    runtime,
    `/api/invitations/${halfArmyInvite}`,
    { headers: { authorization: `Bearer ${halfArmyWhiteToken}` } },
  ));
  assert.equal(halfArmyInvitePreview.state, "waiting");
  assert.equal(halfArmyInvitePreview.variantId, "half-army");
  assert.equal(halfArmyInvitePreview.turnPaceDays, 1);

  const halfArmyVariantConflict = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Half Army White",
      mode: "multiplayer",
      variantId: "pawn-riot",
      turnPaceDays: 1,
      playerToken: halfArmyWhiteToken,
      inviteToken: halfArmyInvite,
      requestId: halfArmyCreateId,
    }),
  });
  assert.equal(halfArmyVariantConflict.status, 409);

  const halfArmyMagicConflict = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Mini Magic Conflict",
      mode: "multiplayer",
      variantId: "pawn-duel",
      worldCode: `0x${"0".repeat(40)}`,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(halfArmyMagicConflict.status, 422);
  assert.equal((await body(halfArmyMagicConflict)).error.code, "variant_magic_conflict");

  const halfArmyJoinedResponse = await request(
    runtime,
    `/api/invitations/${halfArmyInvite}/join`,
    {
      method: "POST",
      body: JSON.stringify({
        displayName: "Half Army Black",
        playerToken: halfArmyBlackToken,
      }),
    },
  );
  assert.equal(halfArmyJoinedResponse.status, 200);
  assert.equal((await body(halfArmyJoinedResponse)).game.variantId, "half-army");

  const halfArmyOpening = new Chess(halfArmyFen)
    .moves({ verbose: true })
    .find((move) => move.from === "c2" && move.to === "c4");
  assert.ok(halfArmyOpening);
  const halfArmyMoveResponse = await request(
    runtime,
    `/api/games/${halfArmyCreated.game.id}/moves`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${halfArmyWhiteToken}` },
      body: JSON.stringify({
        from: halfArmyOpening.from,
        to: halfArmyOpening.to,
        expectedVersion: 1,
        requestId: randomUUID(),
      }),
    },
  );
  assert.equal(halfArmyMoveResponse.status, 200);
  const halfArmyAfterMove = await body(halfArmyMoveResponse);
  assert.equal(halfArmyAfterMove.game.variantId, "half-army");
  assert.equal(halfArmyAfterMove.game.moves.length, 1);
  assert.equal(halfArmyAfterMove.game.moves[0].fenBefore, halfArmyFen);

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
  assert.equal(created.game.variantId, "standard");
  assert.equal(created.game.aiDifficulty, null);
  assert.equal(created.game.turnPaceDays, 3);
  assert.equal(created.game.magicRules, null);
  assert.equal((await request(
    runtime,
    `/api/invitations/${inviteToken}`,
    { anonymous: true },
  )).status, 401);

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

  const waitingInvite = await request(runtime, `/api/invitations/${inviteToken}`, {
    headers: { authorization: `Bearer ${whiteToken}` },
  });
  assert.equal(waitingInvite.status, 200);
  const waitingInviteBody = await body(waitingInvite);
  assert.equal(waitingInviteBody.state, "waiting");
  assert.equal(waitingInviteBody.variantId, "standard");
  assert.equal(waitingInviteBody.turnPaceDays, 3);

  const linkCreator = accountForLabel("Ron");
  const linkCreatorPushEndpoint = `https://fcm.googleapis.com/fcm/send/${secret()}`;
  const linkCreatorPush = await request(runtime, "/api/me/push-devices", {
    method: "PUT",
    accountEmail: linkCreator.email,
    accountName: linkCreator.displayName,
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedUsername: usernameForAccount(linkCreator),
      subscription: {
        endpoint: linkCreatorPushEndpoint,
        expirationTime: null,
        keys: {
          p256dh: pushClientPublicKey,
          auth: randomBytes(16).toString("base64url"),
        },
      },
    }),
  });
  assert.equal(linkCreatorPush.status, 200);

  const inviteIsNotASeat = await request(runtime, `/api/games/${gameId}`, {
    headers: { authorization: `Bearer ${inviteToken}` },
  });
  assert.equal(inviteIsNotASeat.status, 404);

  const linkJoinPushCountBefore = outboundPushRequests.length;
  const joinedResponse = await request(runtime, `/api/invitations/${inviteToken}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Omri", playerToken: blackToken }),
  });
  assert.equal(joinedResponse.status, 200);
  const joined = await body(joinedResponse);
  assert.equal(joined.game.you.color, "b");
  assert.equal(joined.game.you.name, usernameForAccount(accountForLabel("Omri")));
  assert.equal(joined.game.players.white.name, usernameForAccount(accountForLabel("Ron")));
  assert.equal(joined.game.players.black.name, usernameForAccount(accountForLabel("Omri")));
  assert.equal(
    await waitFor(() => outboundPushRequests.length === linkJoinPushCountBefore + 1),
    true,
  );
  assert.equal(outboundPushRequests[linkJoinPushCountBefore].url, linkCreatorPushEndpoint);
  const linkJoinDatabase = await runtime.getD1Database("DB");
  assert.deepEqual(
    await linkJoinDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries
      WHERE game_id = ? AND game_version = ? AND kind = 'your_turn'`)
      .bind(gameId, joined.game.version)
      .first(),
    { count: 1 },
  );

  const linkCreatorActivity = await body(await request(runtime, "/api/me/activity", {
    accountEmail: linkCreator.email,
    accountName: linkCreator.displayName,
  }));
  const acceptedLinkTurnItems = linkCreatorActivity.items.filter(
    (item) => item.kind === "turn" && item.gameId === gameId,
  );
  assert.equal(linkCreatorActivity.unreadCount, 1);
  assert.equal(acceptedLinkTurnItems.length, 1);
  assert.equal(acceptedLinkTurnItems[0].unread, true);
  assert.equal(acceptedLinkTurnItems[0].href, `/g/${gameId}`);
  assert.equal(
    acceptedLinkTurnItems[0].username,
    usernameForAccount(accountForLabel("Omri")),
  );

  const freshTokenJoinRetry = await request(runtime, `/api/invitations/${inviteToken}/join`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Omri", playerToken: secret() }),
  });
  assert.equal(freshTokenJoinRetry.status, 200);
  const freshTokenRetryBody = await body(freshTokenJoinRetry);
  assert.equal(freshTokenRetryBody.game.id, gameId);
  assert.equal(freshTokenRetryBody.game.you.color, "b");
  assert.equal(freshTokenRetryBody.game.version, joined.game.version);
  assert.deepEqual(
    await linkJoinDatabase.prepare(`SELECT COUNT(*) AS count
      FROM push_turn_deliveries
      WHERE game_id = ? AND game_version = ? AND kind = 'your_turn'`)
      .bind(gameId, joined.game.version)
      .first(),
    { count: 1 },
  );
  assert.equal(outboundPushRequests.length, linkJoinPushCountBefore + 1);

  const ambientAccountGamesResponse = await request(runtime, "/api/me/games?limit=1", {
    headers: { authorization: `Bearer ${whiteToken}` },
  });
  assert.equal(ambientAccountGamesResponse.status, 200);
  assert.equal((await body(ambientAccountGamesResponse)).games[0].id, gameId);

  const legacyAccountEmail = "legacy-member@players.chessriot.test";
  await request(runtime, "/api/me/games", {
    accountEmail: legacyAccountEmail,
    accountName: "Legacy Member",
  });
  const legacyAccountId = signedGoogleSession(legacyAccountEmail, "Legacy Member").accountId;
  const membershipDatabase = await runtime.getD1Database("DB");
  const originalWhiteMembership = await membershipDatabase
    .prepare(`SELECT account_id FROM game_memberships
      WHERE game_id = ? AND color = 'w'`)
    .bind(gameId)
    .first();
  assert.equal(typeof originalWhiteMembership?.account_id, "string");
  await membershipDatabase
    .prepare(`UPDATE game_memberships SET account_id = ?
      WHERE game_id = ? AND color = 'w'`)
    .bind(legacyAccountId, gameId)
    .run();
  const legacyBareGame = await request(runtime, `/api/games/${gameId}`, {
    anonymous: true,
    headers: signedAccountHeaders({
      email: legacyAccountEmail,
      displayName: "Legacy Member",
    }),
  });
  assert.equal(legacyBareGame.status, 401);
  const legacyGoogleGame = await request(runtime, `/api/games/${gameId}`, {
    accountEmail: legacyAccountEmail,
    accountName: "Legacy Member",
  });
  assert.equal(legacyGoogleGame.status, 200);
  assert.equal((await request(runtime, `/api/games/${gameId}`, {
    accountEmail: "not-the-member@players.chessriot.test",
    accountName: "Not The Member",
  })).status, 404);
  await membershipDatabase
    .prepare(`UPDATE game_memberships SET account_id = ?
      WHERE game_id = ? AND color = 'w'`)
    .bind(originalWhiteMembership.account_id, gameId)
    .run();

  assert.equal((await request(runtime, "/api/me/games?cursor=broken", {
    headers: { authorization: `Bearer ${whiteToken}` },
  })).status, 400);
  const unrelatedGames = await body(await request(runtime, "/api/me/games", {
    accountEmail: "unrelated@players.chessriot.test",
    accountName: "Unrelated",
  }));
  assert.deepEqual(unrelatedGames.games, []);

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

  const magicWhite = secret();
  const magicBlack = secret();
  const magicInvite = secret();
  const magicCreateRequestId = randomUUID();
  const magicPrompt = "Knights move twice. Rooks move twice. Pawns never get promoted.";
  const unknownWorldCode = `0x${"0".repeat(40)}`;
  const legacyBaseResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: magicWhite,
      inviteToken: magicInvite,
      requestId: magicCreateRequestId,
    }),
  });
  assert.equal(legacyBaseResponse.status, 201);
  const legacyBase = await body(legacyBaseResponse);
  const magicRulesJson = JSON.stringify({
    version: 2,
    rules: [
      { kind: "double_move", piece: "n" },
      { kind: "double_move", piece: "r" },
      { kind: "no_promotion" },
    ],
  });
  const magicDatabase = await runtime.getD1Database("DB");
  await magicDatabase.prepare(`UPDATE game_settings
    SET magic_prompt = ?, magic_rules_json = ?
    WHERE game_id = ?`)
    .bind(magicPrompt, magicRulesJson, legacyBase.game.id)
    .run();

  const magicCreateResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: magicWhite,
      inviteToken: magicInvite,
      requestId: magicCreateRequestId,
    }),
  });
  assert.equal(magicCreateResponse.status, 200);
  const magicCreated = await body(magicCreateResponse);
  const magicGameId = magicCreated.game.id;
  assert.equal(magicCreated.game.magicRules.prompt, magicPrompt);
  assert.equal(magicCreated.game.magicRules.version, 2);
  assert.deepEqual(magicCreated.game.magicRules.labels, [
    "Knights may move up to 2 times per turn; check ends the turn",
    "Rooks may move up to 2 times per turn; check ends the turn",
    "Pawns cannot move onto the final rank",
  ]);

  const magicCreateRetry = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: magicWhite,
      inviteToken: magicInvite,
      requestId: magicCreateRequestId,
    }),
  });
  assert.equal(magicCreateRetry.status, 200);
  assert.equal((await body(magicCreateRetry)).game.id, magicGameId);

  const magicCreateConflict = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: magicWhite,
      inviteToken: magicInvite,
      requestId: magicCreateRequestId,
      worldCode: unknownWorldCode,
    }),
  });
  assert.equal(magicCreateConflict.status, 409);
  assert.equal((await body(magicCreateConflict)).error.code, "idempotency_conflict");

  const unsupportedMagicResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
      worldCode: unknownWorldCode,
    }),
  });
  assert.equal(unsupportedMagicResponse.status, 403);
  assert.equal((await body(unsupportedMagicResponse)).error.code, "magic_rules_unavailable");

  const magicWhiteAccount = accountForLabel("Magic White");
  const magicWhiteUsername = usernameForAccount(accountForLabel("Magic White"));
  const anonymousAccessRequest = await request(runtime, "/api/me/feature-access", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(anonymousAccessRequest.status, 401);
  const crossSiteAccessRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(crossSiteAccessRequest.status, 403);
  const invalidFeatureRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({ feature: "runtime_shell" }),
  });
  assert.equal(invalidFeatureRequest.status, 400);

  const firstAccessRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(firstAccessRequest.status, 201);
  const firstAccessPayload = await body(firstAccessRequest);
  assert.equal(firstAccessPayload.feature, "magic_rules");
  assert.equal(firstAccessPayload.status, "pending");
  assert.equal(Number.isFinite(Date.parse(firstAccessPayload.requestedAt)), true);
  const repeatedAccessRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(repeatedAccessRequest.status, 200);
  assert.deepEqual(await body(repeatedAccessRequest), firstAccessPayload);
  assert.deepEqual(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count FROM feature_access_requests
      WHERE feature_key = 'magic_rules'`).first(),
    { count: 1 },
  );
  const pendingMagicCreate = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
      worldCode: unknownWorldCode,
    }),
  });
  assert.equal(pendingMagicCreate.status, 403);

  const pendingSession = await request(runtime, "/api/auth/session", {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  });
  const pendingSessionPayload = await body(pendingSession);
  assert.equal(pendingSessionPayload.features.magicRules, false);
  assert.deepEqual(pendingSessionPayload.featureRequests, { magicRules: "pending" });

  const listAccessRequests = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-access-requests`,
    {
      method: "POST",
      headers: { origin: controlOrigin, "content-type": "text/plain" },
      body: opsGrant({
        scope: "feature-access-requests:manage",
        featureKey: "magic_rules",
        action: "list",
      }),
    },
  );
  assert.equal(listAccessRequests.status, 200);
  const accessQueue = await body(listAccessRequests);
  assert.equal(accessQueue.pendingCount, 1);
  assert.equal(accessQueue.truncated, false);
  assert.deepEqual(accessQueue.requests, [{
    id: accessQueue.requests[0].id,
    username: magicWhiteUsername,
    requestedAt: firstAccessPayload.requestedAt,
  }]);

  const approveAccessRequest = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-access-requests`,
    {
      method: "POST",
      headers: { origin: controlOrigin, "content-type": "text/plain" },
      body: opsGrant({
        scope: "feature-access-requests:manage",
        featureKey: "magic_rules",
        action: "approve",
        requestId: accessQueue.requests[0].id,
      }),
    },
  );
  assert.equal(approveAccessRequest.status, 200);
  assert.deepEqual(await body(approveAccessRequest), {
    feature: "magic_rules",
    requestId: accessQueue.requests[0].id,
    username: magicWhiteUsername,
    decision: "approved",
    enabled: true,
  });
  const replayedApproval = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-access-requests`,
    {
      method: "POST",
      headers: { origin: controlOrigin, "content-type": "text/plain" },
      body: opsGrant({
        scope: "feature-access-requests:manage",
        featureKey: "magic_rules",
        action: "approve",
        requestId: accessQueue.requests[0].id,
      }),
    },
  );
  assert.equal(replayedApproval.status, 404);

  const listMagicResponse = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-flags/magic-rules`,
    {
      method: "POST",
      headers: {
        origin: controlOrigin,
        "content-type": "text/plain",
      },
      body: opsGrant({ scope: "feature-flags:manage" }),
    },
  );
  assert.equal(listMagicResponse.status, 200);
  assert.deepEqual(await body(listMagicResponse), {
    feature: "magic_rules",
    usernames: [magicWhiteUsername],
  });

  // Exercise the game-creation cache boundary without making a live provider
  // call from the local end-to-end runtime. Interpreter/provider behavior is
  // covered separately by the Magic compiler unit tests.
  const compilerVersion = "runtime-magic-v3:gpt-5.6-luna:2026-07-28";
  const compiledPrompt = "No castling.";
  const compilationCacheKey = createHash("sha256")
    .update(`${compilerVersion}\n${compiledPrompt}`)
    .digest("hex");
  const compilationTime = new Date().toISOString();
  await magicDatabase.prepare(`INSERT INTO magic_rule_compilations (
      cache_key, compiler_version, status, rules_json,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, 'compiled', ?, NULL, NULL, ?, ?)`)
    .bind(
      compilationCacheKey,
      compilerVersion,
      JSON.stringify({
        version: 3,
        rules: [{ kind: "forbid_action", action: "castling" }],
      }),
      compilationTime,
      compilationTime,
    )
    .run();

  const whitelistedMagicRequestId = randomUUID();
  const appliedWorldResponse = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: whitelistedMagicRequestId,
      prompt: compiledPrompt,
    }),
  });
  assert.equal(appliedWorldResponse.status, 201);
  const appliedWorld = await body(appliedWorldResponse);
  assert.deepEqual(
    await magicDatabase.prepare(`SELECT status, world_code
      FROM magic_rule_compilations WHERE cache_key = ?`)
      .bind(compilationCacheKey)
      .first(),
    { status: "ready", world_code: appliedWorld.world.code },
  );
  assert.match(appliedWorld.world.code, /^0x[0-9a-f]{40}$/);
  assert.match(appliedWorld.world.displayCode, /^0x[0-9A-F]{6}…[0-9A-F]{4}$/);
  assert.equal(appliedWorld.creditCost, 1);
  assert.equal(appliedWorld.creditBalance, 9);
  const repeatedApply = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: whitelistedMagicRequestId,
      prompt: compiledPrompt,
    }),
  });
  assert.equal(repeatedApply.status, 200);
  assert.equal((await body(repeatedApply)).creditBalance, 9);
  const changedApplyReplay = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: whitelistedMagicRequestId,
      prompt: "Knights move twice.",
    }),
  });
  assert.equal(changedApplyReplay.status, 409);
  assert.equal((await body(changedApplyReplay)).error.code, "idempotency_conflict");

  const retryMagicAccount = {
    email: "magic-retry@players.chessriot.test",
    displayName: "Magic Retry",
  };
  await prepareRegisteredAccount(runtime, retryMagicAccount);
  const retryMagicAccountId = signedGoogleSession(
    retryMagicAccount.email,
    retryMagicAccount.displayName,
  ).accountId;
  await magicDatabase.prepare(`INSERT INTO account_feature_flags (
    account_id, feature_key, enabled, updated_at
  ) VALUES (?, 'magic_rules', 1, ?)`)
    .bind(retryMagicAccountId, new Date().toISOString())
    .run();
  const retryMagicRequestId = randomUUID();
  const retryMagicFingerprint = createHash("sha256")
    .update(JSON.stringify({
      version: 1,
      worldCode: null,
      prompt: compiledPrompt,
      parentCode: null,
    }))
    .digest("hex");
  await magicDatabase.prepare(`INSERT INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, created_at
    ) VALUES (?, ?, -1, 'magic_spend', ?, ?)`)
    .bind(
      `magic:${retryMagicRequestId}:${retryMagicFingerprint}`,
      retryMagicAccountId,
      `magic:${retryMagicRequestId}`,
      new Date().toISOString(),
    )
    .run();
  const rateNow = Math.floor(Date.now() / 1_000);
  const rateWindowStart = Math.floor(rateNow / 3_600) * 3_600;
  const rateExpiry = rateWindowStart + 3_600;
  await magicDatabase.batch(["magic_apply", "magic_compile"].map((scope) =>
    magicDatabase.prepare(`INSERT INTO rate_limit_windows (
        key, account_id, scope, window_start, hit_count, expires_at
      ) VALUES (?, ?, ?, ?, 100, ?)`)
      .bind(
        `${retryMagicAccountId}:${scope}:${rateWindowStart}`,
        retryMagicAccountId,
        scope,
        rateWindowStart,
        rateExpiry,
      )));
  const pendingDebitRetry = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: retryMagicAccount.email,
    accountName: retryMagicAccount.displayName,
    body: JSON.stringify({
      requestId: retryMagicRequestId,
      prompt: compiledPrompt,
    }),
  });
  assert.equal(pendingDebitRetry.status, 200);
  assert.equal((await body(pendingDebitRetry)).world.code, appliedWorld.world.code);
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM account_credit_ledger
      WHERE account_id = ? AND source_key = ? AND reason = 'magic_spend'`)
      .bind(retryMagicAccountId, `magic:${retryMagicRequestId}`)
      .first("count"),
    1,
  );

  const whitelistedMagicResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: whitelistedMagicRequestId,
      worldCode: appliedWorld.world.code,
    }),
  });
  assert.equal(whitelistedMagicResponse.status, 201);
  const whitelistedMagic = await body(whitelistedMagicResponse);
  assert.equal(whitelistedMagic.game.world.code, appliedWorld.world.code);
  assert.equal(whitelistedMagic.game.magicRules.prompt, "No castling");

  const worldsResponse = await request(runtime, "/api/worlds?view=map", {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  });
  assert.equal(worldsResponse.status, 200);
  assert.equal((await body(worldsResponse)).nodes[0].code, appliedWorld.world.code);

  const forkPrompt = "Knights move twice. No castling.";
  const forkCacheKey = createHash("sha256")
    .update(`${compilerVersion}\n${forkPrompt}`)
    .digest("hex");
  await magicDatabase.prepare(`INSERT INTO magic_rule_compilations (
      cache_key, compiler_version, status, rules_json,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, 'compiled', ?, NULL, NULL, ?, ?)`)
    .bind(
      forkCacheKey,
      compilerVersion,
      JSON.stringify({
        version: 3,
        rules: [
          { kind: "move_sequence", pieces: ["n"], maxMoves: 2 },
          { kind: "forbid_action", action: "castling" },
        ],
      }),
      compilationTime,
      compilationTime,
    )
    .run();
  const forkRequestId = randomUUID();
  const forkResponse = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: forkRequestId,
      prompt: forkPrompt,
      parentCode: appliedWorld.world.code,
    }),
  });
  assert.equal(forkResponse.status, 201);
  const forkedWorld = await body(forkResponse);
  assert.notEqual(forkedWorld.world.code, appliedWorld.world.code);
  assert.deepEqual(
    await magicDatabase.prepare(`SELECT parent_code, child_code
      FROM magic_world_derivations WHERE parent_code = ? AND child_code = ?`)
      .bind(appliedWorld.world.code, forkedWorld.world.code)
      .first(),
    { parent_code: appliedWorld.world.code, child_code: forkedWorld.world.code },
  );
  const cycleRequestId = randomUUID();
  const rejectedCycle = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: cycleRequestId,
      prompt: compiledPrompt,
      parentCode: forkedWorld.world.code,
    }),
  });
  assert.equal(rejectedCycle.status, 409);
  assert.equal((await body(rejectedCycle)).error.code, "lineage_conflict");
  assert.equal((await body(await request(runtime, "/api/me/referral", {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  }))).credits, 8);
  const refundedReplay = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({
      requestId: cycleRequestId,
      prompt: compiledPrompt,
      parentCode: forkedWorld.world.code,
    }),
  });
  assert.equal(refundedReplay.status, 409);
  assert.equal((await body(refundedReplay)).error.code, "idempotency_conflict");
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM magic_world_entitlements WHERE game_create_request_id = ?`)
      .bind(cycleRequestId)
      .first("count"),
    0,
  );
  const recoveredReservation = await body(await request(runtime, "/api/worlds/apply", {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  }));
  assert.equal(recoveredReservation.reservation.gameCreateRequestId, forkRequestId);
  assert.equal(recoveredReservation.reservation.world.code, forkedWorld.world.code);

  const worldFan = {
    email: "world-fan@players.chessriot.test",
    displayName: "World Fan",
  };
  await prepareRegisteredAccount(runtime, worldFan);
  const worldFanAccountId = signedGoogleSession(worldFan.email, worldFan.displayName).accountId;
  await magicDatabase.prepare(`INSERT INTO account_feature_flags (
    account_id, feature_key, enabled, updated_at
  ) VALUES (?, 'magic_rules', 1, ?)`)
    .bind(worldFanAccountId, new Date().toISOString())
    .run();
  const concurrentReplayRequestId = randomUUID();
  const concurrentReplayResponses = await Promise.all([
    request(runtime, "/api/worlds/apply", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        requestId: concurrentReplayRequestId,
        prompt: compiledPrompt,
      }),
    }),
    request(runtime, "/api/worlds/apply", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        requestId: concurrentReplayRequestId,
        prompt: compiledPrompt,
      }),
    }),
  ]);
  assert.deepEqual(
    concurrentReplayResponses.map((response) => response.status),
    [200, 200],
  );
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM account_credit_ledger
      WHERE account_id = ? AND source_key = ? AND reason = 'magic_spend'`)
      .bind(worldFanAccountId, `magic:${concurrentReplayRequestId}`)
      .first("count"),
    1,
  );
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM magic_world_entitlements WHERE game_create_request_id = ?`)
      .bind(concurrentReplayRequestId)
      .first("count"),
    1,
  );

  const concurrentConflictRequestId = randomUUID();
  const concurrentConflictResponses = await Promise.all([
    request(runtime, "/api/worlds/apply", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        requestId: concurrentConflictRequestId,
        prompt: compiledPrompt,
      }),
    }),
    request(runtime, "/api/worlds/apply", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        requestId: concurrentConflictRequestId,
        prompt: forkPrompt,
      }),
    }),
  ]);
  const concurrentConflictStatuses = concurrentConflictResponses
    .map((response) => response.status)
    .sort((left, right) => left - right);
  assert.equal(concurrentConflictStatuses[0], 200);
  assert.equal(concurrentConflictStatuses[1], 409);
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM account_credit_ledger
      WHERE account_id = ? AND source_key = ? AND reason = 'magic_spend'`)
      .bind(worldFanAccountId, `magic:${concurrentConflictRequestId}`)
      .first("count"),
    1,
  );
  assert.equal(
    await magicDatabase.prepare(`SELECT COUNT(*) AS count
      FROM magic_world_entitlements WHERE game_create_request_id = ?`)
      .bind(concurrentConflictRequestId)
      .first("count"),
    1,
  );
  const translatedPrompt = "אסור להצריח";
  const translatedCacheKey = createHash("sha256")
    .update(`${compilerVersion}\n${translatedPrompt}`)
    .digest("hex");
  await magicDatabase.prepare(`INSERT INTO magic_rule_compilations (
      cache_key, compiler_version, status, rules_json,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, 'compiled', ?, NULL, NULL, ?, ?)`)
    .bind(
      translatedCacheKey,
      compilerVersion,
      JSON.stringify({
        version: 3,
        rules: [{ kind: "forbid_action", action: "castling" }],
      }),
      compilationTime,
      compilationTime,
    )
    .run();
  const translatedApply = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: worldFan.email,
    accountName: worldFan.displayName,
    body: JSON.stringify({ requestId: randomUUID(), prompt: translatedPrompt }),
  });
  assert.equal(translatedApply.status, 200);
  assert.equal((await body(translatedApply)).world.code, appliedWorld.world.code);
  for (let index = 0; index < 5; index += 1) {
    const paidRequestId = requestIdForColor("w");
    const paidApply = await request(runtime, "/api/worlds/apply", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        requestId: paidRequestId,
        worldCode: appliedWorld.world.code,
      }),
    });
    assert.equal(paidApply.status, 200);
    const playerToken = secret();
    const paidGame = await request(runtime, "/api/games", {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      body: JSON.stringify({
        displayName: worldFan.displayName,
        mode: "solo",
        difficulty: 1,
        playerToken,
        inviteToken: secret(),
        requestId: paidRequestId,
        worldCode: appliedWorld.world.code,
      }),
    });
    assert.equal(paidGame.status, 201);
    const paidGameBody = await body(paidGame);
    const paidMove = await request(runtime, `/api/games/${paidGameBody.game.id}/moves`, {
      method: "POST",
      accountEmail: worldFan.email,
      accountName: worldFan.displayName,
      headers: { authorization: `Bearer ${playerToken}` },
      body: JSON.stringify({
        from: "e2",
        to: "e4",
        expectedVersion: 0,
        requestId: randomUUID(),
      }),
    });
    assert.equal(paidMove.status, 200);
  }
  assert.deepEqual(
    await magicDatabase.prepare(`SELECT COALESCE(SUM(amount), 0) AS credits
      FROM account_credit_ledger
      WHERE account_id = ? AND world_code = ? AND reason = 'world_royalty'`)
      .bind(signedGoogleSession(magicWhiteAccount.email, magicWhiteAccount.displayName).accountId, appliedWorld.world.code)
      .first(),
    { credits: 1 },
  );
  const botOpeningRequestId = requestIdForColor("b");
  const botOpeningApply = await request(runtime, "/api/worlds/apply", {
    method: "POST",
    accountEmail: worldFan.email,
    accountName: worldFan.displayName,
    body: JSON.stringify({
      requestId: botOpeningRequestId,
      worldCode: appliedWorld.world.code,
    }),
  });
  assert.equal(botOpeningApply.status, 200);
  const botOpeningGame = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: worldFan.email,
    accountName: worldFan.displayName,
    body: JSON.stringify({
      displayName: worldFan.displayName,
      mode: "solo",
      difficulty: 1,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: botOpeningRequestId,
      worldCode: appliedWorld.world.code,
    }),
  });
  assert.equal(botOpeningGame.status, 201);
  assert.equal((await body(botOpeningGame)).game.plyCount, 1);
  const playedWorld = await body(await request(runtime, `/api/worlds/${appliedWorld.world.code}`, {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  }));
  assert.equal(playedWorld.world.gamesPlayed, 5);
  assert.deepEqual(
    await magicDatabase.prepare(`SELECT COALESCE(SUM(amount), 0) AS credits
      FROM account_credit_ledger
      WHERE account_id = ? AND world_code = ? AND reason = 'world_royalty'`)
      .bind(signedGoogleSession(magicWhiteAccount.email, magicWhiteAccount.displayName).accountId, appliedWorld.world.code)
      .first(),
    { credits: 1 },
  );

  const disableMagicResponse = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-flags/magic-rules`,
    {
      method: "POST",
      headers: {
        origin: controlOrigin,
        "content-type": "text/plain",
      },
      body: opsGrant({
        scope: "feature-flags:manage",
        targetUsername: magicWhiteUsername,
        enabled: false,
      }),
    },
  );
  assert.equal(disableMagicResponse.status, 200);

  const disabledMagicResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic White",
      mode: "multiplayer",
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
      worldCode: appliedWorld.world.code,
    }),
  });
  assert.equal(disabledMagicResponse.status, 403);
  assert.equal((await body(disabledMagicResponse)).error.code, "magic_rules_unavailable");

  const secondAccessRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(secondAccessRequest.status, 201);
  const secondAccessQueueResponse = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-access-requests`,
    {
      method: "POST",
      headers: { origin: controlOrigin, "content-type": "text/plain" },
      body: opsGrant({
        scope: "feature-access-requests:manage",
        featureKey: "magic_rules",
        action: "list",
      }),
    },
  );
  assert.equal(secondAccessQueueResponse.status, 200);
  const secondAccessQueue = await body(secondAccessQueueResponse);
  assert.equal(secondAccessQueue.pendingCount, 1);
  const dismissAccessRequest = await runtime.dispatchFetch(
    `${origin}/api/ops/feature-access-requests`,
    {
      method: "POST",
      headers: { origin: controlOrigin, "content-type": "text/plain" },
      body: opsGrant({
        scope: "feature-access-requests:manage",
        featureKey: "magic_rules",
        action: "dismiss",
        requestId: secondAccessQueue.requests[0].id,
      }),
    },
  );
  assert.equal(dismissAccessRequest.status, 200);
  assert.deepEqual(await body(dismissAccessRequest), {
    feature: "magic_rules",
    requestId: secondAccessQueue.requests[0].id,
    username: magicWhiteUsername,
    decision: "dismissed",
    enabled: false,
  });
  const dismissedSession = await request(runtime, "/api/auth/session", {
    accountEmail: magicWhiteAccount.email,
    accountName: magicWhiteAccount.displayName,
  });
  const dismissedSessionPayload = await body(dismissedSession);
  assert.equal(dismissedSessionPayload.features.magicRules, false);
  assert.deepEqual(dismissedSessionPayload.featureRequests, { magicRules: null });

  const magicPreviewResponse = await request(
    runtime,
    `/api/invitations/${magicInvite}`,
    {
      accountEmail: "magic-black@players.chessriot.test",
      accountName: "Magic Black",
    },
  );
  assert.equal(magicPreviewResponse.status, 200);
  const magicPreview = await body(magicPreviewResponse);
  assert.equal(magicPreview.state, "waiting");
  assert.deepEqual(magicPreview.magicRules.labels, magicCreated.game.magicRules.labels);

  const magicJoinResponse = await request(
    runtime,
    `/api/invitations/${magicInvite}/join`,
    {
      method: "POST",
      accountEmail: "magic-black@players.chessriot.test",
      accountName: "Magic Black",
      body: JSON.stringify({
        displayName: "Magic Black",
        playerToken: magicBlack,
      }),
    },
  );
  assert.equal(magicJoinResponse.status, 200);
  const magicJoined = await body(magicJoinResponse);
  assert.equal(magicJoined.game.version, 1);
  assert.deepEqual(magicJoined.game.magicRules.labels, magicCreated.game.magicRules.labels);

  const playMagicMove = async (
    token,
    from,
    to,
    expectedVersion,
    second,
  ) => {
    const response = await request(runtime, `/api/games/${magicGameId}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        from,
        to,
        expectedVersion,
        requestId: randomUUID(),
        ...(second ? { second } : {}),
      }),
    });
    return { response, data: await body(response) };
  };

  assert.equal((await playMagicMove(magicWhite, "a2", "a4", 1)).response.status, 200);
  assert.equal((await playMagicMove(magicBlack, "h7", "h6", 2)).response.status, 200);
  const atomicRookTurn = await playMagicMove(
    magicWhite,
    "a1",
    "a3",
    3,
    { from: "a3", to: "h3" },
  );
  assert.equal(atomicRookTurn.response.status, 200);
  assert.equal(atomicRookTurn.data.game.version, 4);
  assert.equal(atomicRookTurn.data.game.plyCount, 3);
  assert.equal(atomicRookTurn.data.game.turn, "b");
  assert.deepEqual(atomicRookTurn.data.game.moves[2].second, {
    from: "a3",
    to: "h3",
    san: "Rh3",
  });
  assert.equal((await playMagicMove(magicBlack, "g8", "f6", 4)).response.status, 200);
  const atomicKnightTurn = await playMagicMove(
    magicWhite,
    "g1",
    "f3",
    5,
    { from: "f3", to: "e5" },
  );
  assert.equal(atomicKnightTurn.response.status, 200);
  assert.equal(atomicKnightTurn.data.game.version, 6);
  assert.equal(atomicKnightTurn.data.game.plyCount, 5);
  assert.equal(atomicKnightTurn.data.game.turn, "b");
  assert.deepEqual(atomicKnightTurn.data.game.moves[4].second, {
    from: "f3",
    to: "e5",
    san: "Ne5",
  });
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
  const prematureRecap = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: "{}",
  });
  assert.equal(prematureRecap.status, 409);
  assert.equal((await body(prematureRecap)).error.code, "game_not_complete");
  const mateRequestId = randomUUID();
  const mate = await move(blackToken, "d8", "h4", 4, mateRequestId);
  assert.equal(mate.response.status, 200);
  assert.equal(mate.data.game.status, "completed");
  assert.equal(mate.data.game.outcome.reason, "checkmate");
  assert.equal(mate.data.game.outcome.winner, "b");
  assert.equal(mate.data.game.moves.length, 4);
  const crossSiteRecap = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}`, origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(crossSiteRecap.status, 403);
  const anonymousRecap = await request(runtime, `/api/games/${gameId}/recap-share`, {
    anonymous: true,
    method: "POST",
    body: "{}",
  });
  assert.equal(anonymousRecap.status, 401);
  const nonParticipantRecap = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    accountEmail: "recap-outsider@players.chessriot.test",
    accountName: "Recap Outsider",
    body: "{}",
  });
  assert.equal(nonParticipantRecap.status, 404);
  const createdRecapResponse = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: "{}",
  });
  assert.equal(createdRecapResponse.status, 201);
  const createdRecap = await body(createdRecapResponse);
  const recapUrl = new URL(createdRecap.url);
  assert.equal(recapUrl.origin, origin);
  assert.match(recapUrl.pathname, /^\/recap\/[0-9a-f-]{36}$/i);
  const replayedRecapResponse = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    headers: { authorization: `Bearer ${blackToken}` },
    body: "{}",
  });
  assert.equal(replayedRecapResponse.status, 200);
  assert.equal((await body(replayedRecapResponse)).url, createdRecap.url);
  const publicRecapResponse = await request(runtime, recapUrl.pathname, { anonymous: true });
  assert.equal(publicRecapResponse.status, 200);
  const publicRecapHtml = await publicRecapResponse.text();
  assert.match(publicRecapHtml, /Shared match recap|SHARED MATCH RECAP/i);
  assert.doesNotMatch(publicRecapHtml, /whiteToken|blackToken|inviteToken|accountId|requestId/i);
  const revokeRecapResponse = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${blackToken}` },
  });
  assert.equal(revokeRecapResponse.status, 204);
  assert.equal((await request(runtime, recapUrl.pathname, { anonymous: true })).status, 404);
  const recreatedRecapResponse = await request(runtime, `/api/games/${gameId}/recap-share`, {
    method: "POST",
    headers: { authorization: `Bearer ${whiteToken}` },
    body: "{}",
  });
  assert.equal(recreatedRecapResponse.status, 201);
  assert.notEqual((await body(recreatedRecapResponse)).url, createdRecap.url);
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
  assert.deepEqual(whiteState.game.you, {
    color: "w",
    name: usernameForAccount(accountForLabel("Ron")),
  });
  assert.deepEqual(blackState.game.you, {
    color: "b",
    name: usernameForAccount(accountForLabel("Omri")),
  });

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

  const timeoutDatabase = await runtime.getD1Database("DB");
  for (const pace of [1, 3, 5]) {
    const timeoutWhite = secret();
    const timeoutBlack = secret();
    const timeoutInvite = secret();
    const whiteName = `Pace ${pace} White`;
    const blackName = `Pace ${pace} Black`;
    const timeoutCreated = await body(await request(runtime, "/api/games", {
      method: "POST",
      body: JSON.stringify({
        displayName: whiteName,
        mode: "multiplayer",
        turnPaceDays: pace,
        playerToken: timeoutWhite,
        inviteToken: timeoutInvite,
        requestId: randomUUID(),
      }),
    }));
    assert.equal(timeoutCreated.game.status, "waiting");
    assert.equal(timeoutCreated.game.turnPaceDays, pace);
    assert.equal(timeoutCreated.game.deadlineAt, null);

    assert.equal((await request(runtime, `/api/invitations/${timeoutInvite}`, {
      anonymous: true,
    })).status, 401);
    const timeoutPreview = await body(await request(
      runtime,
      `/api/invitations/${timeoutInvite}`,
      { headers: { authorization: `Bearer ${timeoutWhite}` } },
    ));
    assert.equal(timeoutPreview.state, "waiting");
    assert.equal(timeoutPreview.turnPaceDays, pace);

    const timeoutJoined = await body(await request(
      runtime,
      `/api/invitations/${timeoutInvite}/join`,
      {
        method: "POST",
        body: JSON.stringify({ displayName: blackName, playerToken: timeoutBlack }),
      },
    ));
    assert.equal(timeoutJoined.game.status, "active");
    assert.equal(timeoutJoined.game.turnPaceDays, pace);
    assert.equal(
      Date.parse(timeoutJoined.game.deadlineAt),
      Date.parse(timeoutJoined.game.updatedAt) + pace * 24 * 60 * 60_000,
    );

    const recoveredClaim = await request(runtime, `/api/invitations/${timeoutInvite}`, {
      headers: { authorization: `Bearer ${timeoutBlack}` },
    });
    assert.equal(recoveredClaim.status, 410);
    assert.deepEqual(await body(recoveredClaim), {
      state: "claimed",
      gameId: timeoutCreated.game.id,
    });
    assert.equal((await request(runtime, `/api/games/${timeoutCreated.game.id}`, {
      headers: { authorization: `Bearer ${timeoutBlack}` },
    })).status, 200);

    const deliberatelyOldMutation = new Date(Date.now() - 60_000).toISOString();
    await timeoutDatabase
      .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
      .bind(deliberatelyOldMutation, timeoutCreated.game.id)
      .run();
    const beforeMove = await body(await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}`,
      { headers: { authorization: `Bearer ${timeoutWhite}` } },
    ));
    assert.equal(
      Date.parse(beforeMove.game.deadlineAt),
      Date.parse(deliberatelyOldMutation) + pace * 24 * 60 * 60_000,
    );

    const moveRequestId = randomUUID();
    const acceptedMoveResponse = await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}/moves`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${timeoutWhite}` },
        body: JSON.stringify({
          from: "e2",
          to: "e4",
          expectedVersion: beforeMove.game.version,
          requestId: moveRequestId,
        }),
      },
    );
    assert.equal(acceptedMoveResponse.status, 200);
    const afterMove = await body(acceptedMoveResponse);
    assert.equal(afterMove.game.turn, "b");
    assert.equal(afterMove.game.plyCount, 1);
    assert.equal(afterMove.game.turnPaceDays, pace);
    assert.equal(
      Date.parse(afterMove.game.deadlineAt),
      Date.parse(afterMove.game.updatedAt) + pace * 24 * 60 * 60_000,
    );
    assert.ok(Date.parse(afterMove.game.deadlineAt) > Date.parse(beforeMove.game.deadlineAt));

    const repeatedMove = await body(await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}/moves`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${timeoutWhite}` },
        body: JSON.stringify({
          from: "e2",
          to: "e4",
          expectedVersion: beforeMove.game.version,
          requestId: moveRequestId,
        }),
      },
    ));
    assert.equal(repeatedMove.game.version, afterMove.game.version);
    assert.equal(repeatedMove.game.updatedAt, afterMove.game.updatedAt);
    assert.equal(repeatedMove.game.deadlineAt, afterMove.game.deadlineAt);
    assert.equal(repeatedMove.game.plyCount, 1);

    const wrongTurn = await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}/moves`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${timeoutWhite}` },
        body: JSON.stringify({
          from: "d2",
          to: "d4",
          expectedVersion: afterMove.game.version,
          requestId: randomUUID(),
        }),
      },
    );
    assert.equal(wrongTurn.status, 409);
    assert.equal((await body(wrongTurn)).error.code, "wrong_turn");
    const afterRejection = await body(await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}`,
      { headers: { authorization: `Bearer ${timeoutBlack}` } },
    ));
    assert.equal(afterRejection.game.version, afterMove.game.version);
    assert.equal(afterRejection.game.fen, afterMove.game.fen);
    assert.equal(afterRejection.game.updatedAt, afterMove.game.updatedAt);
    assert.equal(afterRejection.game.deadlineAt, afterMove.game.deadlineAt);

    const almostExpiredMutation = new Date(
      Date.now() - pace * 24 * 60 * 60_000 + 30_000,
    ).toISOString();
    await timeoutDatabase
      .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
      .bind(almostExpiredMutation, timeoutCreated.game.id)
      .run();
    const stillActive = await body(await request(
      runtime,
      `/api/games/${timeoutCreated.game.id}`,
      { headers: { authorization: `Bearer ${timeoutBlack}` } },
    ));
    assert.equal(stillActive.game.status, "active");

    const expiredMutation = new Date(
      Date.now() - pace * 24 * 60 * 60_000 - 5_000,
    ).toISOString();
    const authoritativeFinish = new Date(
      Date.parse(expiredMutation) + pace * 24 * 60 * 60_000,
    ).toISOString();
    await timeoutDatabase
      .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
      .bind(expiredMutation, timeoutCreated.game.id)
      .run();

    if (pace === 1) {
      const expiredTurnReaction = await request(
        runtime,
        `/api/games/${timeoutCreated.game.id}/reactions`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${timeoutBlack}` },
          body: JSON.stringify({ reaction: "hi", requestId: randomUUID() }),
        },
      );
      assert.equal(expiredTurnReaction.status, 409);
      assert.equal((await body(expiredTurnReaction)).error.code, "reactions_closed");
    } else if (pace === 3) {
      const timeoutActivity = await body(await request(runtime, "/api/me/activity", {
        headers: { authorization: `Bearer ${timeoutWhite}` },
      }));
      assert.equal(timeoutActivity.items.find(
        (item) => item.gameId === timeoutCreated.game.id,
      )?.kind, "result");
    } else {
      const timeoutListTrigger = await request(runtime, "/api/me/games?view=watch&limit=50", {
        headers: {
          authorization: `Bearer ${pace === 1 ? timeoutWhite : timeoutBlack}`,
        },
      });
      assert.equal(timeoutListTrigger.status, 200);
    }

    const timeoutRow = await timeoutDatabase
      .prepare(`SELECT status, turn_color, version, ply_count, current_fen,
          winner_color, termination, updated_at, finished_at
        FROM games WHERE id = ?`)
      .bind(timeoutCreated.game.id)
      .first();
    assert.equal(timeoutRow.status, "completed");
    assert.equal(timeoutRow.turn_color, "b");
    assert.equal(timeoutRow.winner_color, "w");
    assert.equal(timeoutRow.termination, "timeout");
    assert.equal(timeoutRow.version, afterMove.game.version + 1);
    assert.equal(timeoutRow.ply_count, 1);
    assert.equal(timeoutRow.current_fen, afterMove.game.fen);
    assert.equal(timeoutRow.updated_at, authoritativeFinish);
    assert.equal(timeoutRow.finished_at, authoritativeFinish);
    assert.equal((await timeoutDatabase
      .prepare("SELECT COUNT(*) AS count FROM moves WHERE game_id = ?")
      .bind(timeoutCreated.game.id)
      .first()).count, 1);
    assert.equal((await timeoutDatabase
      .prepare("SELECT COUNT(*) AS count FROM game_actions WHERE game_id = ?")
      .bind(timeoutCreated.game.id)
      .first()).count, 0);

    for (const token of [timeoutWhite, timeoutBlack]) {
      const seatView = await body(await request(
        runtime,
        `/api/games/${timeoutCreated.game.id}`,
        { headers: { authorization: `Bearer ${token}` } },
      ));
      assert.equal(seatView.game.status, "completed");
      assert.deepEqual(seatView.game.outcome, { winner: "w", reason: "timeout" });
      assert.equal(seatView.game.deadlineAt, null);
    }
    const whiteHistory = await body(await request(
      runtime,
      "/api/me/games?view=watch&limit=50",
      { headers: { authorization: `Bearer ${timeoutWhite}` } },
    ));
    const historyGame = whiteHistory.games.find(
      (game) => game.id === timeoutCreated.game.id,
    );
    assert.equal(historyGame.status, "completed");
    assert.equal(historyGame.turnPaceDays, pace);
    assert.deepEqual(historyGame.outcome, { winner: "w", reason: "timeout" });

    const lateMove = await request(runtime, `/api/games/${timeoutCreated.game.id}/moves`, {
      method: "POST",
      headers: { authorization: `Bearer ${timeoutBlack}` },
      body: JSON.stringify({
        from: "e7",
        to: "e5",
        expectedVersion: afterMove.game.version,
        requestId: randomUUID(),
      }),
    });
    assert.equal(lateMove.status, 409);
    assert.equal((await body(lateMove)).error.code, "game_not_active");
    assert.equal((await request(runtime, `/api/games/${timeoutCreated.game.id}/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${timeoutBlack}` },
      body: JSON.stringify({
        expectedVersion: afterMove.game.version,
        requestId: randomUUID(),
      }),
    })).status, 409);
    assert.equal((await request(runtime, `/api/games/${timeoutCreated.game.id}/claims`, {
      method: "POST",
      headers: { authorization: `Bearer ${timeoutBlack}` },
      body: JSON.stringify({
        claim: "threefold_repetition",
        expectedVersion: afterMove.game.version,
        requestId: randomUUID(),
      }),
    })).status, 409);
  }

  const whiteTurnTimeoutWhite = secret();
  const whiteTurnTimeoutBlack = secret();
  const whiteTurnTimeoutInvite = secret();
  const whiteTurnTimeoutCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "White Turn Timeout White",
      mode: "multiplayer",
      turnPaceDays: 1,
      playerToken: whiteTurnTimeoutWhite,
      inviteToken: whiteTurnTimeoutInvite,
      requestId: randomUUID(),
    }),
  }));
  const whiteTurnTimeoutJoined = await body(await request(
    runtime,
    `/api/invitations/${whiteTurnTimeoutInvite}/join`,
    {
      method: "POST",
      body: JSON.stringify({
        displayName: "White Turn Timeout Black",
        playerToken: whiteTurnTimeoutBlack,
      }),
    },
  ));
  const whiteTurnExpiredAt = new Date(
    Date.now() - 24 * 60 * 60_000 - 5_000,
  ).toISOString();
  await timeoutDatabase
    .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
    .bind(whiteTurnExpiredAt, whiteTurnTimeoutCreated.game.id)
    .run();
  const whiteTurnTimeoutList = await body(await request(
    runtime,
    "/api/me/games?view=watch&limit=50",
    { headers: { authorization: `Bearer ${whiteTurnTimeoutBlack}` } },
  ));
  const whiteTurnTimeoutSummary = whiteTurnTimeoutList.games.find(
    (game) => game.id === whiteTurnTimeoutCreated.game.id,
  );
  assert.equal(whiteTurnTimeoutSummary.status, "completed");
  assert.deepEqual(whiteTurnTimeoutSummary.outcome, { winner: "b", reason: "timeout" });
  assert.deepEqual(
    (await body(await request(
      runtime,
      `/api/games/${whiteTurnTimeoutCreated.game.id}`,
      { headers: { authorization: `Bearer ${whiteTurnTimeoutWhite}` } },
    ))).game.outcome,
    { winner: "b", reason: "timeout" },
  );
  const whiteTurnTimeoutRow = await timeoutDatabase
    .prepare(`SELECT turn_color, winner_color, version, ply_count, finished_at
      FROM games WHERE id = ?`)
    .bind(whiteTurnTimeoutCreated.game.id)
    .first();
  assert.equal(whiteTurnTimeoutRow.turn_color, "w");
  assert.equal(whiteTurnTimeoutRow.winner_color, "b");
  assert.equal(whiteTurnTimeoutRow.version, whiteTurnTimeoutJoined.game.version + 1);
  assert.equal(whiteTurnTimeoutRow.ply_count, 0);
  assert.equal(
    whiteTurnTimeoutRow.finished_at,
    new Date(Date.parse(whiteTurnExpiredAt) + 24 * 60 * 60_000).toISOString(),
  );

  const legacyPaceWhite = secret();
  const legacyPaceBlack = secret();
  const legacyPaceInvite = secret();
  const legacyPaceCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Legacy Pace White",
      mode: "multiplayer",
      turnPaceDays: 5,
      playerToken: legacyPaceWhite,
      inviteToken: legacyPaceInvite,
      requestId: randomUUID(),
    }),
  }));
  const legacyPaceJoined = await body(await request(
    runtime,
    `/api/invitations/${legacyPaceInvite}/join`,
    {
      method: "POST",
      body: JSON.stringify({
        displayName: "Legacy Pace Black",
        playerToken: legacyPaceBlack,
      }),
    },
  ));
  await timeoutDatabase
    .prepare("UPDATE game_settings SET turn_pace_days = NULL WHERE game_id = ?")
    .bind(legacyPaceCreated.game.id)
    .run();
  await timeoutDatabase
    .prepare("UPDATE games SET updated_at = ? WHERE id = ?")
    .bind("2025-01-01T00:00:00.000Z", legacyPaceCreated.game.id)
    .run();
  const legacyPaceList = await body(await request(runtime, "/api/me/games?limit=50", {
    headers: { authorization: `Bearer ${legacyPaceWhite}` },
  }));
  const legacyPaceSummary = legacyPaceList.games.find(
    (game) => game.id === legacyPaceCreated.game.id,
  );
  assert.equal(legacyPaceSummary.status, "active");
  assert.equal(legacyPaceSummary.turnPaceDays, null);
  const legacyPaceMove = await body(await request(
    runtime,
    `/api/games/${legacyPaceCreated.game.id}/moves`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${legacyPaceWhite}` },
      body: JSON.stringify({
        from: "e2",
        to: "e4",
        expectedVersion: legacyPaceJoined.game.version,
        requestId: randomUUID(),
      }),
    },
  ));
  assert.equal(legacyPaceMove.game.status, "active");
  assert.equal(legacyPaceMove.game.turnPaceDays, null);
  assert.equal(legacyPaceMove.game.deadlineAt, null);

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

  const magicSoloToken = secret();
  const magicSoloResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Magic Solo",
      mode: "solo",
      difficulty: 2,
      playerToken: magicSoloToken,
      inviteToken: secret(),
      requestId: requestIdForColor("w"),
      worldCode: unknownWorldCode,
    }),
  });
  assert.equal(magicSoloResponse.status, 403);
  assert.equal((await body(magicSoloResponse)).error.code, "magic_rules_unavailable");

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
  assert.equal(soloAfterHumanMove.game.version, 2);
  assert.equal(soloAfterHumanMove.game.plyCount, 2);
  assert.equal(soloAfterHumanMove.game.turn, "w");
  assert.equal(soloAfterHumanMove.game.moves.length, 2);
  assert.deepEqual(
    soloAfterHumanMove.game.moves.map((move) => move.color),
    ["w", "b"],
  );

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

  // A game left between releases with a durable human ply still recovers its
  // pending bot turn on the next authorized read.
  const soloDatabase = await runtime.getD1Database("DB");
  const durableHumanMove = await soloDatabase
    .prepare(`SELECT fen_after, created_at FROM moves
      WHERE game_id = ? AND ply = 1`)
    .bind(soloGameId)
    .first();
  await soloDatabase.batch([
    soloDatabase
      .prepare("DELETE FROM moves WHERE game_id = ? AND ply = 2")
      .bind(soloGameId),
    soloDatabase
      .prepare(`UPDATE games SET
        status = 'active', current_fen = ?, turn_color = 'b',
        version = 1, ply_count = 1, winner_color = NULL, termination = NULL,
        last_mutation_nonce = ?, updated_at = ?, finished_at = NULL
        WHERE id = ?`)
      .bind(
        durableHumanMove.fen_after,
        randomUUID(),
        durableHumanMove.created_at,
        soloGameId,
      ),
  ]);
  await runtime.dispose();
  runtime = createRuntime();
  const soloAfterRestart = await body(await request(runtime, `/api/games/${soloGameId}`, {
    headers: { authorization: `Bearer ${soloToken}` },
  }));
  assert.equal(soloAfterRestart.game.version, 2);
  assert.equal(soloAfterRestart.game.moves.length, 2);
  assert.equal(soloAfterRestart.game.turn, "w");

  const pawnRiotFen = "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1";
  const pawnRiotToken = secret();
  const pawnRiotCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Pawn Riot White",
      mode: "solo",
      variantId: "pawn-riot",
      difficulty: 2,
      playerToken: pawnRiotToken,
      inviteToken: secret(),
      requestId: requestIdForColor("w"),
    }),
  });
  assert.equal(pawnRiotCreatedResponse.status, 201);
  const pawnRiotCreated = await body(pawnRiotCreatedResponse);
  assert.equal(pawnRiotCreated.game.variantId, "pawn-riot");
  assert.equal(pawnRiotCreated.game.initialFen, pawnRiotFen);
  assert.equal(pawnRiotCreated.game.version, 0);
  const pawnRiotMoveResponse = await request(
    runtime,
    `/api/games/${pawnRiotCreated.game.id}/moves`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${pawnRiotToken}` },
      body: JSON.stringify({
        from: "e2",
        to: "e4",
        expectedVersion: 0,
        requestId: randomUUID(),
      }),
    },
  );
  assert.equal(pawnRiotMoveResponse.status, 200);
  const pawnRiotAfterMove = await body(pawnRiotMoveResponse);
  assert.equal(pawnRiotAfterMove.game.variantId, "pawn-riot");
  assert.equal(pawnRiotAfterMove.game.version, 2);
  assert.deepEqual(
    pawnRiotAfterMove.game.moves.map((move) => move.color),
    ["w", "b"],
  );

  const pawnDuelFen = "4k3/2ppp3/8/8/8/8/2PPP3/4K3 w - - 0 1";
  const pawnDuelToken = secret();
  const pawnDuelCreatedResponse = await request(runtime, "/api/games", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Pawn Duel Black",
      mode: "solo",
      variantId: "pawn-duel",
      difficulty: 2,
      playerToken: pawnDuelToken,
      inviteToken: secret(),
      requestId: requestIdForColor("b"),
    }),
  });
  assert.equal(pawnDuelCreatedResponse.status, 201);
  const pawnDuelCreated = await body(pawnDuelCreatedResponse);
  assert.equal(pawnDuelCreated.game.variantId, "pawn-duel");
  assert.equal(pawnDuelCreated.game.initialFen, pawnDuelFen);
  assert.equal(pawnDuelCreated.game.you.color, "b");
  assert.equal(pawnDuelCreated.game.version, 1);
  assert.equal(pawnDuelCreated.game.moves[0].fenBefore, pawnDuelFen);
  const pawnDuelPosition = new Chess(pawnDuelCreated.game.fen);
  const pawnDuelReply = pawnDuelPosition.moves({ verbose: true })[0];
  assert.ok(pawnDuelReply);
  const pawnDuelReplyResponse = await request(
    runtime,
    `/api/games/${pawnDuelCreated.game.id}/moves`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${pawnDuelToken}` },
      body: JSON.stringify({
        from: pawnDuelReply.from,
        to: pawnDuelReply.to,
        ...(pawnDuelReply.promotion ? { promotion: pawnDuelReply.promotion } : {}),
        expectedVersion: 1,
        requestId: randomUUID(),
      }),
    },
  );
  assert.equal(pawnDuelReplyResponse.status, 200);
  assert.equal((await body(pawnDuelReplyResponse)).game.version, 3);

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
  assert.equal(
    blackSoloCreated.game.players.black.name,
    usernameForAccount(accountForLabel("Ron")),
  );
  assert.equal(blackSoloCreated.game.version, 1);
  assert.equal(blackSoloCreated.game.plyCount, 1);
  assert.equal(blackSoloCreated.game.initialFen, new Chess().fen());
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
  assert.equal(blackSoloAfterHumanReply.game.version, 3);
  assert.equal(blackSoloAfterHumanReply.game.plyCount, 3);
  assert.equal(blackSoloAfterHumanReply.game.moves[1].color, "b");
  assert.equal(blackSoloAfterHumanReply.game.moves[2].color, "w");
  assert.equal(blackSoloAfterHumanReply.game.turn, "b");

  const blackSoloDatabase = await runtime.getD1Database("DB");
  const durableBlackMove = await blackSoloDatabase
    .prepare(`SELECT fen_after, created_at FROM moves
      WHERE game_id = ? AND ply = 2`)
    .bind(blackSoloGameId)
    .first();
  await blackSoloDatabase.batch([
    blackSoloDatabase
      .prepare("DELETE FROM moves WHERE game_id = ? AND ply = 3")
      .bind(blackSoloGameId),
    blackSoloDatabase
      .prepare(`UPDATE games SET
        status = 'active', current_fen = ?, turn_color = 'w',
        version = 2, ply_count = 2, winner_color = NULL, termination = NULL,
        last_mutation_nonce = ?, updated_at = ?, finished_at = NULL
        WHERE id = ?`)
      .bind(
        durableBlackMove.fen_after,
        randomUUID(),
        durableBlackMove.created_at,
        blackSoloGameId,
      ),
  ]);

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
  const concurrentResults = await Promise.all(
    [concurrentMove(), concurrentMove()].map(async (pendingResponse) => {
      const response = await pendingResponse;
      return { status: response.status, state: await body(response) };
    }),
  );
  assert.deepEqual(concurrentResults.map((result) => result.status), [200, 200]);
  assert.equal(concurrentResults[0].state.game.moves.length, 1);
  assert.equal(concurrentResults[1].state.game.moves.length, 1);
  repetitionVersion = concurrentResults[0].state.game.version;
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
  const feedbackGuestToken = secret();
  assert.equal((await request(runtime, "/api/feedback", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      title: "",
      comment: feedbackComment,
      page: "/g/private-game?secret=never-store-this",
      requestId: randomUUID(),
      guestToken: feedbackGuestToken,
    }),
  })).status, 400);
  const feedbackResponse = await request(runtime, "/api/feedback", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      title: feedbackTitle,
      comment: feedbackComment,
      page: "/g/game-id?ignored=yes",
      requestId: feedbackRequestId,
      guestToken: feedbackGuestToken,
    }),
  });
  assert.equal(feedbackResponse.status, 201);
  const createdFeedback = await body(feedbackResponse);
  assert.equal(createdFeedback.status, "received");
  const feedbackRetry = await request(runtime, "/api/feedback", {
    anonymous: true,
    method: "POST",
    body: JSON.stringify({
      title: feedbackTitle,
      comment: feedbackComment,
      page: "/g/game-id",
      requestId: feedbackRequestId,
      guestToken: feedbackGuestToken,
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
    row.event_name === "reaction.sent" && row.outcome === "success" && row.count === 5));
  assert.ok(overview.breakdown.some((row) =>
    row.event_name === "reaction.retry" && row.outcome === "success" && row.count === 2));
  assert.ok(overview.breakdown.every((row) => row.event_name !== "system.health_checked"));
  assert.ok(overview.breakdown.every((row) => row.event_name !== "observability.viewed"));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(soloToken)));
  assert.equal(overview.feedback[0].title, feedbackTitle);
  assert.equal(overview.feedback[0].comment, feedbackComment);
  assert.equal(overview.feedback[0].page, "/g/game-id");
  assert.equal(overview.feedbackPool.total, 1);
  assert.equal(overview.feedbackPool.new, 1);
  assert.equal(overview.feedbackPool.reviewed, 0);
  assert.equal(overview.feedbackPool.closed, 0);
  assert.equal(overview.feedbackPool.unresolved, 1);
  assert.equal(overview.feedbackPool.items[0].id, createdFeedback.id);
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackTitle)));
  assert.ok(overview.recentEvents.every((event) => !JSON.stringify(event).includes(feedbackComment)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousReaction)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousHeaderRequestId)));
  assert.ok(overview.recentEvents.every((event) =>
    !JSON.stringify(event).includes(maliciousBodyRequestId)));

  const journeyDatabase = await runtime.getD1Database("DB");
  const journeyAccount = signedGoogleSession(
    accountForLabel("Ron").email,
    accountForLabel("Ron").displayName,
  );
  const journeyCreatedAt = new Date(Date.now() - 48 * 60 * 60_000);
  const journeyUsernameAt = new Date(journeyCreatedAt.getTime() + 2 * 60_000).toISOString();
  const journeyGameAt = new Date(journeyCreatedAt.getTime() + 4 * 60_000).toISOString();
  const journeyMoveAt = new Date(journeyCreatedAt.getTime() + 6 * 60_000).toISOString();
  await journeyDatabase.batch([
    journeyDatabase.prepare(`UPDATE accounts
      SET created_at = ?, username_set_at = ? WHERE id = ?`)
      .bind(journeyCreatedAt.toISOString(), journeyUsernameAt, journeyAccount.accountId),
    journeyDatabase.prepare(`UPDATE game_memberships
      SET claimed_at = ? WHERE game_id = ? AND account_id = ?`)
      .bind(journeyGameAt, gameId, journeyAccount.accountId),
    journeyDatabase.prepare(`UPDATE moves SET created_at = ?
      WHERE game_id = ? AND color = 'w'`)
      .bind(journeyMoveAt, gameId),
  ]);

  const analyticsResponse = await request(runtime, "/api/ops/analytics?window=7", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant(),
  });
  assert.equal(analyticsResponse.status, 200);
  const analytics = await body(analyticsResponse);
  assert.equal(analytics.environment, "test");
  assert.equal(analytics.window.days, 7);
  assert.equal(analytics.privacy.identifiersReturned, false);
  assert.equal(analytics.privacy.crossEnvironmentJoin, false);
  assert.equal(analytics.newAccountFunnel.steps.length, 4);
  assert.equal(analytics.journeyMonitor.definitionVersion, 1);
  assert.equal(analytics.journeyMonitor.cohort.maturityHours, 24);
  assert.deepEqual(
    analytics.journeyMonitor.stages.map((stage) => stage.key),
    ["account", "username", "game_started", "first_move"],
  );
  assert.ok(analytics.journeyMonitor.stages.every((stage) => stage.accounts >= 1));
  assert.ok(analytics.journeyMonitor.medianMinutesToFirstMove >= 0);
  assert.ok(analytics.engagement.gamesCreated > 0);
  assert.ok(analytics.engagement.successfulMoves > 0);
  assert.equal(analytics.quality.authFailures, null);
  assert.equal(analytics.daily, undefined);
  const analyticsJson = JSON.stringify(analytics);
  assert.doesNotMatch(analyticsJson, /actor_hash|actorHash|requestId|recentEvents|"username":/i);
  assert.equal((await request(runtime, "/api/ops/analytics", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "feedback:manage" }),
  })).status, 403);

  const closePath = `/api/ops/feedback/${createdFeedback.id}/close`;
  assert.equal((await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant(),
  })).status, 403);
  assert.equal((await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "feedback:manage" }),
  })).status, 403);
  const validFeedbackGrant = opsGrant({ scope: "feedback:manage" });
  const tamperedFeedbackGrant = validFeedbackGrant.slice(0, -1)
    + (validFeedbackGrant.endsWith("a") ? "b" : "a");
  assert.equal((await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: tamperedFeedbackGrant,
  })).status, 403);
  assert.equal((await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "application/json", origin: controlOrigin },
    body: validFeedbackGrant,
  })).status, 403);
  const successfulFeedbackGrant = opsGrant({ scope: "feedback:manage" });
  const closeResponse = await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: successfulFeedbackGrant,
  });
  assert.equal(closeResponse.status, 200);
  assert.equal(closeResponse.headers.get("access-control-allow-origin"), controlOrigin);
  assert.deepEqual(await body(closeResponse), {
    feedback: { id: createdFeedback.id, status: "closed" },
    changed: true,
  });
  const closeRetry = await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "feedback:manage" }),
  });
  assert.equal(closeRetry.status, 200);
  assert.equal((await body(closeRetry)).changed, false);
  assert.equal((await request(runtime, `/api/ops/feedback/${randomUUID()}/close`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "feedback:manage" }),
  })).status, 404);
  assert.equal((await request(runtime, "/api/ops/feedback/not-a-uuid/close", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "feedback:manage" }),
  })).status, 404);
  const expiredFeedbackGrantAt = Math.floor(Date.now() / 1000) - 10;
  assert.equal((await request(runtime, closePath, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({
      scope: "feedback:manage",
      iat: expiredFeedbackGrantAt - 120,
      exp: expiredFeedbackGrantAt,
    }),
  })).status, 403);
  const wrongFeedbackOrigin = await runtime.dispatchFetch(`${origin}${closePath}`, {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "text/plain" },
    body: opsGrant({ scope: "feedback:manage" }),
  });
  assert.equal(wrongFeedbackOrigin.status, 403);
  assert.equal(wrongFeedbackOrigin.headers.get("access-control-allow-origin"), null);

  const closedOverviewResponse = await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant(),
  });
  assert.equal(closedOverviewResponse.status, 200);
  const closedOverview = await body(closedOverviewResponse);
  assert.equal(closedOverview.feedbackPool.total, 1);
  assert.equal(closedOverview.feedbackPool.unresolved, 0);
  assert.equal(closedOverview.feedbackPool.closed, 1);
  assert.equal(closedOverview.feedbackPool.items[0].status, "closed");
  const closeEvents = closedOverview.recentEvents.filter((event) =>
    event.event === "feedback.closed");
  assert.equal(closeEvents.filter((event) =>
    event.outcome === "success" && event.statusCode === 200).length, 2);
  assert.ok(closeEvents.length >= 2);
  assert.ok(closeEvents.every((event) =>
    event.route === "/api/ops/feedback/:id/close"));
  assert.ok(closeEvents.every((event) =>
    !JSON.stringify(event).includes(feedbackTitle)
    && !JSON.stringify(event).includes(feedbackComment)
    && !JSON.stringify(event).includes(createdFeedback.id)
    && !JSON.stringify(event).includes(successfulFeedbackGrant)));

  const observabilityDatabase = await runtime.getD1Database("DB");
  const cappedFeedbackStatements = [];
  for (let index = 0; index < 105; index += 1) {
    cappedFeedbackStatements.push(observabilityDatabase
      .prepare(`INSERT INTO feedback (
        id, request_id, title, comment, page, environment, app_version, status, created_at
      ) VALUES (?, ?, ?, NULL, '/', 'test', '0.13.5', 'closed', ?)`)
      .bind(
        randomUUID(),
        randomUUID(),
        `Closed feedback ${index}`,
        new Date(Date.now() + index).toISOString(),
      ));
  }
  cappedFeedbackStatements.push(observabilityDatabase
    .prepare(`INSERT INTO feedback (
      id, request_id, title, comment, page, environment, app_version, status, created_at
    ) VALUES (?, ?, 'Reviewed feedback', NULL, '/', 'test', '0.13.5', 'reviewed', ?)`)
    .bind(randomUUID(), randomUUID(), new Date(0).toISOString()));
  await observabilityDatabase.batch(cappedFeedbackStatements);
  const cappedOverviewResponse = await request(runtime, "/api/ops/overview", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant(),
  });
  assert.equal(cappedOverviewResponse.status, 200);
  const cappedOverview = await body(cappedOverviewResponse);
  assert.equal(cappedOverview.feedbackPool.total, 107);
  assert.equal(cappedOverview.feedbackPool.unresolved, 1);
  assert.equal(cappedOverview.feedbackPool.reviewed, 1);
  assert.equal(cappedOverview.feedbackPool.closed, 106);
  assert.equal(cappedOverview.feedbackPool.items.length, 100);
  assert.equal(cappedOverview.feedbackPool.items[0].status, "reviewed");

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
  const createTelemetry = await observabilityDatabase
    .prepare(`SELECT metadata_json FROM observability_events
      WHERE event_name = 'game.created'`)
    .all();
  const createMetadata = createTelemetry.results
    .map((event) => JSON.parse(event.metadata_json));
  assert.ok(createMetadata.some((metadata) => metadata.variantId === "half-army"));
  assert.ok(createMetadata.some((metadata) => metadata.variantId === "standard"));
  assert.ok(createMetadata.every((metadata) =>
    !Object.hasOwn(metadata, "initialFen")
    && !Object.hasOwn(metadata, "fen")));

  const atomicJoinHost = accountForLabel("Atomic Join Host");
  const atomicJoinWhiteToken = secret();
  const atomicJoinInvite = secret();
  const atomicJoinCreated = await body(await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: atomicJoinHost.email,
    accountName: atomicJoinHost.displayName,
    body: JSON.stringify({
      displayName: atomicJoinHost.displayName,
      mode: "multiplayer",
      playerToken: atomicJoinWhiteToken,
      inviteToken: atomicJoinInvite,
      requestId: randomUUID(),
    }),
  }));
  const creatorCannotClaimBlack = await request(
    runtime,
    `/api/invitations/${atomicJoinInvite}/join`,
    {
      method: "POST",
      accountEmail: atomicJoinHost.email,
      accountName: atomicJoinHost.displayName,
      body: JSON.stringify({
        displayName: atomicJoinHost.displayName,
        playerToken: secret(),
      }),
    },
  );
  assert.equal(creatorCannotClaimBlack.status, 409);
  assert.equal((await body(creatorCannotClaimBlack)).error.code, "same_player");

  const atomicJoiners = [accountForLabel("Atomic Join Alpha"), accountForLabel("Atomic Join Beta")];
  const atomicBlackTokens = [secret(), secret()];
  const atomicJoinResponses = await Promise.all(atomicJoiners.map((account, index) =>
    request(runtime, `/api/invitations/${atomicJoinInvite}/join`, {
      method: "POST",
      accountEmail: account.email,
      accountName: account.displayName,
      body: JSON.stringify({
        displayName: account.displayName,
        playerToken: atomicBlackTokens[index],
      }),
    })));
  assert.deepEqual(atomicJoinResponses.map((response) => response.status).sort(), [200, 409]);
  const atomicWinnerIndex = atomicJoinResponses.findIndex((response) => response.status === 200);
  assert.notEqual(atomicWinnerIndex, -1);
  const atomicJoinDatabase = await runtime.getD1Database("DB");
  const settledAtomicJoin = await atomicJoinDatabase
    .prepare(`SELECT games.status, games.joined_at, games.black_name,
        game_memberships.account_id AS black_account_id
      FROM games
      LEFT JOIN game_memberships
        ON game_memberships.game_id = games.id AND game_memberships.color = 'b'
      WHERE games.id = ?`)
    .bind(atomicJoinCreated.game.id)
    .first();
  assert.equal(settledAtomicJoin.status, "active");
  assert.equal(typeof settledAtomicJoin.joined_at, "string");
  assert.equal(
    settledAtomicJoin.black_name,
    usernameForAccount(atomicJoiners[atomicWinnerIndex]),
  );
  assert.equal(
    settledAtomicJoin.black_account_id,
    signedGoogleSession(
      atomicJoiners[atomicWinnerIndex].email,
      atomicJoiners[atomicWinnerIndex].displayName,
    ).accountId,
  );
  const atomicBlackMembershipCount = await atomicJoinDatabase
    .prepare("SELECT COUNT(*) AS count FROM game_memberships WHERE game_id = ? AND color = 'b'")
    .bind(atomicJoinCreated.game.id)
    .first();
  assert.equal(atomicBlackMembershipCount.count, 1);
  const atomicJoinRetry = await request(runtime, `/api/invitations/${atomicJoinInvite}/join`, {
    method: "POST",
    accountEmail: atomicJoiners[atomicWinnerIndex].email,
    accountName: atomicJoiners[atomicWinnerIndex].displayName,
    body: JSON.stringify({
      displayName: atomicJoiners[atomicWinnerIndex].displayName,
      playerToken: atomicBlackTokens[atomicWinnerIndex],
    }),
  });
  assert.equal(atomicJoinRetry.status, 200);

  const legacyHistoryAccount = accountForLabel("Legacy History Owner");
  const legacyHistoryToken = secret();
  const legacyHistoryGame = await body(await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: legacyHistoryAccount.email,
    accountName: legacyHistoryAccount.displayName,
    body: JSON.stringify({
      displayName: legacyHistoryAccount.displayName,
      mode: "multiplayer",
      playerToken: legacyHistoryToken,
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  }));
  await atomicJoinDatabase
    .prepare("DELETE FROM game_settings WHERE game_id = ?")
    .bind(legacyHistoryGame.game.id)
    .run();
  const legacyHistory = await body(await request(
    runtime,
    "/api/me/games?mode=multiplayer&variant=standard&magic=no&limit=24",
    { headers: { authorization: `Bearer ${legacyHistoryToken}` } },
  ));
  const legacyHistorySummary = legacyHistory.games.find((game) =>
    game.id === legacyHistoryGame.game.id);
  assert.deepEqual(
    {
      mode: legacyHistorySummary?.mode,
      variantId: legacyHistorySummary?.variantId,
      isMagic: legacyHistorySummary?.isMagic,
    },
    { mode: "multiplayer", variantId: "standard", isMagic: false },
  );

  const usernameRateAccount = accountForLabel("Username Rate Player");
  const usernameRateValue = usernameForAccount(usernameRateAccount);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request(runtime, "/api/me/username", {
      method: "POST",
      accountEmail: usernameRateAccount.email,
      accountName: usernameRateAccount.displayName,
      body: JSON.stringify({ username: usernameRateValue }),
    });
    assert.equal(response.status, 200);
  }
  const blockedUsernameAttempt = await request(runtime, "/api/me/username", {
    method: "POST",
    accountEmail: usernameRateAccount.email,
    accountName: usernameRateAccount.displayName,
    body: JSON.stringify({ username: usernameRateValue }),
  });
  assert.equal(blockedUsernameAttempt.status, 429);
  assert.equal((await body(blockedUsernameAttempt)).error.code, "rate_limited");
  assert.match(blockedUsernameAttempt.headers.get("retry-after") ?? "", /^\d+$/);

  const responseRateSender = accountForLabel("Response Rate Sender");
  const responseRateRecipient = accountForLabel("Response Rate Recipient");
  await prepareRegisteredAccount(runtime, responseRateRecipient);
  const responseRateRequest = await body(await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: responseRateSender.email,
    accountName: responseRateSender.displayName,
    body: JSON.stringify({ username: usernameForAccount(responseRateRecipient) }),
  }));
  const responseRateResult = await request(
    runtime,
    `/api/me/friend-requests/${responseRateRequest.requestId}`,
    {
      method: "PATCH",
      accountEmail: responseRateRecipient.email,
      accountName: responseRateRecipient.displayName,
      body: JSON.stringify({ action: "accept" }),
    },
  );
  assert.equal(responseRateResult.status, 200);
  const responseRateRow = await atomicJoinDatabase
    .prepare(`SELECT hit_count FROM rate_limit_windows
      WHERE account_id = ? AND scope = 'friend_request_response'`)
    .bind(signedGoogleSession(
      responseRateRecipient.email,
      responseRateRecipient.displayName,
    ).accountId)
    .first();
  assert.equal(responseRateRow.hit_count, 1);

  const resendRaceLeft = accountForLabel("Resend Race Left");
  const resendRaceRight = accountForLabel("Resend Race Right");
  await prepareRegisteredAccount(runtime, resendRaceRight);
  const initialResendRequest = await body(await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: resendRaceLeft.email,
    accountName: resendRaceLeft.displayName,
    body: JSON.stringify({ username: usernameForAccount(resendRaceRight) }),
  }));
  const declinedResendRequest = await request(
    runtime,
    `/api/me/friend-requests/${initialResendRequest.requestId}`,
    {
      method: "PATCH",
      accountEmail: resendRaceRight.email,
      accountName: resendRaceRight.displayName,
      body: JSON.stringify({ action: "decline" }),
    },
  );
  assert.equal(declinedResendRequest.status, 200);
  const resendRaceResponses = await Promise.all([
    request(runtime, "/api/me/friend-requests", {
      method: "POST",
      accountEmail: resendRaceLeft.email,
      accountName: resendRaceLeft.displayName,
      body: JSON.stringify({ username: usernameForAccount(resendRaceRight) }),
    }),
    request(runtime, "/api/me/friend-requests", {
      method: "POST",
      accountEmail: resendRaceRight.email,
      accountName: resendRaceRight.displayName,
      body: JSON.stringify({ username: usernameForAccount(resendRaceLeft) }),
    }),
  ]);
  assert.deepEqual(resendRaceResponses.map((response) => response.status).sort(), [201, 409]);
  const resendAccountIds = [resendRaceLeft, resendRaceRight].map((account) =>
    signedGoogleSession(account.email, account.displayName).accountId);
  const settledResendRace = await atomicJoinDatabase
    .prepare("SELECT sender_account_id, recipient_account_id, status FROM friend_requests WHERE pair_key = ?")
    .bind([...resendAccountIds].sort().join(":"))
    .first();
  assert.equal(settledResendRace.status, "pending");
  assert.deepEqual(
    [settledResendRace.sender_account_id, settledResendRace.recipient_account_id].sort(),
    [...resendAccountIds].sort(),
  );

  const safetyLeft = accountForLabel("Safety Left");
  const safetyRight = accountForLabel("Safety Right");
  await prepareRegisteredAccount(runtime, safetyRight);
  const safetyRequest = await body(await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: safetyLeft.email,
    accountName: safetyLeft.displayName,
    body: JSON.stringify({ username: usernameForAccount(safetyRight) }),
  }));
  const activityResponse = await request(runtime, "/api/me/activity", {
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
  });
  assert.equal(activityResponse.status, 200);
  const activity = await body(activityResponse);
  assert.equal(activity.unreadCount, 1);
  assert.equal(activity.items[0].kind, "friend_request");
  assert.equal(activity.items[0].requestId, safetyRequest.requestId);
  assert.equal((await request(runtime, "/api/me/activity", {
    method: "POST",
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
    body: JSON.stringify({ snapshotAt: activity.snapshotAt }),
  })).status, 200);
  assert.equal((await body(await request(runtime, "/api/me/activity", {
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
  }))).unreadCount, 0);
  assert.equal((await request(runtime, `/api/me/friend-requests/${safetyRequest.requestId}`, {
    method: "PATCH",
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
    body: JSON.stringify({ action: "accept" }),
  })).status, 200);
  const safetyReport = await request(runtime, "/api/me/reports", {
    method: "POST",
    accountEmail: safetyLeft.email,
    accountName: safetyLeft.displayName,
    body: JSON.stringify({
      username: usernameForAccount(safetyRight),
      category: "harassment",
      note: "Repeated unwanted messages",
      block: true,
    }),
  });
  assert.equal(safetyReport.status, 201);
  const safetyReportPayload = await body(safetyReport);
  assert.equal(safetyReportPayload.blocked, true);
  const blockedSummary = await body(await request(runtime, "/api/me/blocks", {
    accountEmail: safetyLeft.email,
    accountName: safetyLeft.displayName,
  }));
  assert.deepEqual(blockedSummary.blocked.map((entry) => entry.username), [usernameForAccount(safetyRight)]);
  const safetySocial = await body(await request(runtime, "/api/me/friends", {
    accountEmail: safetyLeft.email,
    accountName: safetyLeft.displayName,
  }));
  assert.equal(safetySocial.friends.length, 0);
  assert.equal((await request(runtime, "/api/me/friend-requests", {
    method: "POST",
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
    body: JSON.stringify({ username: usernameForAccount(safetyLeft) }),
  })).status, 409);
  const safetyOps = await request(runtime, "/api/ops/safety-reports", {
    anonymous: true,
    method: "POST",
    headers: { "content-type": "text/plain", origin: controlOrigin },
    body: opsGrant({ scope: "safety:manage" }),
  });
  assert.equal(safetyOps.status, 200);
  assert.equal((await body(safetyOps)).reports.some((report) => (
    report.id === safetyReportPayload.reportId
    && report.reporterUsername === usernameForAccount(safetyLeft)
    && report.targetUsername === usernameForAccount(safetyRight)
  )), true);
  const reviewSafetyReport = await request(
    runtime,
    `/api/ops/safety-reports/${safetyReportPayload.reportId}/status?status=reviewed`,
    {
      anonymous: true,
      method: "POST",
      headers: { "content-type": "text/plain", origin: controlOrigin },
      body: opsGrant({ scope: "safety:manage" }),
    },
  );
  assert.equal(reviewSafetyReport.status, 200);
  const deleteReportedPlayer = await request(runtime, "/api/me/account", {
    method: "DELETE",
    accountEmail: safetyRight.email,
    accountName: safetyRight.displayName,
    body: JSON.stringify({ username: usernameForAccount(safetyRight) }),
  });
  assert.equal(deleteReportedPlayer.status, 200);
  assert.deepEqual(
    await atomicJoinDatabase.prepare(`SELECT status, target_username FROM safety_report_archive
      WHERE id = ?`).bind(safetyReportPayload.reportId).first(),
    { status: "reviewed", target_username: usernameForAccount(safetyRight) },
  );

  const expiredTelemetryId = randomUUID();
  const expiredSafetyArchiveId = randomUUID();
  await atomicJoinDatabase.batch([
    atomicJoinDatabase.prepare(`INSERT INTO observability_events (
      id, occurred_at, environment, app_version, event_name, outcome
    ) VALUES (?, ?, 'test', '0.21.0', 'expired.test', 'success')`)
      .bind(expiredTelemetryId, "2026-01-01T00:00:00.000Z"),
    atomicJoinDatabase.prepare(`INSERT INTO safety_report_archive (
      id, reporter_username, target_username, category, note, status,
      created_at, archived_at, expires_at
    ) VALUES (?, 'ExpiredReporter', 'ExpiredTarget', 'other', NULL, 'closed',
      '2025-12-01T00:00:00.000Z', '2025-12-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z')`)
      .bind(expiredSafetyArchiveId),
  ]);
  const retentionTrigger = await request(runtime, "/api/auth/session", { anonymous: true });
  assert.equal(retentionTrigger.status, 200);
  assert.equal(await waitFor(async () => {
    const [telemetry, safetyArchive] = await Promise.all([
      atomicJoinDatabase.prepare("SELECT id FROM observability_events WHERE id = ?")
        .bind(expiredTelemetryId)
        .first(),
      atomicJoinDatabase.prepare("SELECT id FROM safety_report_archive WHERE id = ?")
        .bind(expiredSafetyArchiveId)
        .first(),
    ]);
    return !telemetry && !safetyArchive;
  }), true);

  const privacyAccount = accountForLabel("Privacy Delete");
  const privacyGameResponse = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    body: JSON.stringify({
      mode: "solo",
      difficulty: 1,
      variantId: "standard",
      humanColor: "w",
      displayName: privacyAccount.displayName,
      playerToken: secret(),
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(privacyGameResponse.status, 201);
  const privacyGame = (await body(privacyGameResponse)).game;
  const privacyColor = privacyGame.you.color;
  const privacyRecapToken = secret();
  const privacyRecapGameResponse = await request(runtime, "/api/games", {
    method: "POST",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    body: JSON.stringify({
      mode: "solo",
      difficulty: 1,
      variantId: "standard",
      humanColor: "w",
      displayName: privacyAccount.displayName,
      playerToken: privacyRecapToken,
      inviteToken: secret(),
      requestId: randomUUID(),
    }),
  });
  assert.equal(privacyRecapGameResponse.status, 201);
  const privacyRecapGame = (await body(privacyRecapGameResponse)).game;
  const privacyRecapEnd = await request(runtime, `/api/games/${privacyRecapGame.id}/end`, {
    method: "POST",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    headers: { authorization: `Bearer ${privacyRecapToken}` },
    body: JSON.stringify({
      expectedVersion: privacyRecapGame.version,
      requestId: randomUUID(),
    }),
  });
  assert.equal(privacyRecapEnd.status, 200);
  const privacyRecapResponse = await request(runtime, `/api/games/${privacyRecapGame.id}/recap-share`, {
    method: "POST",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    headers: { authorization: `Bearer ${privacyRecapToken}` },
    body: "{}",
  });
  assert.equal(privacyRecapResponse.status, 201);
  const privacyRecapPath = new URL((await body(privacyRecapResponse)).url).pathname;
  assert.equal((await request(runtime, privacyRecapPath, { anonymous: true })).status, 200);
  const privacyAccessRequest = await request(runtime, "/api/me/feature-access", {
    method: "POST",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    body: JSON.stringify({ feature: "magic_rules" }),
  });
  assert.equal(privacyAccessRequest.status, 201);
  const privacyAccessPayload = await body(privacyAccessRequest);
  const privacyAccountId = signedGoogleSession(
    privacyAccount.email,
    privacyAccount.displayName,
  ).accountId;
  const privacyAccessRow = await atomicJoinDatabase
    .prepare("SELECT id FROM feature_access_requests WHERE account_id = ?")
    .bind(privacyAccountId)
    .first();
  assert.match(privacyAccessRow.id, /^[0-9a-f-]{36}$/);
  const privacyWorldTime = new Date().toISOString();
  const foreignWorldTime = "2026-06-12T03:04:05.678Z";
  const foreignPrivacyGame = await atomicJoinDatabase.prepare(`SELECT games.id
    FROM games
    WHERE NOT EXISTS (
      SELECT 1 FROM game_memberships
      WHERE game_memberships.game_id = games.id
        AND game_memberships.account_id = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM magic_world_uses
      WHERE magic_world_uses.game_id = games.id
    )
    ORDER BY games.created_at, games.id
    LIMIT 1`)
    .bind(privacyAccountId)
    .first();
  assert.match(foreignPrivacyGame.id, /^[0-9a-f-]{36}$/);
  await atomicJoinDatabase.prepare(`UPDATE game_settings SET world_code = ?
    WHERE game_id IN (?, ?)`)
    .bind(appliedWorld.world.code, privacyGame.id, privacyRecapGame.id)
    .run();
  await atomicJoinDatabase.prepare(`INSERT INTO magic_world_sources (
      source_key, world_code, contributor_account_id, prompt_hash,
      compiler_version, parent_code, kind, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, 'rediscover', ?)`)
    .bind(
      `privacy-source:${privacyAccountId}`,
      appliedWorld.world.code,
      privacyAccountId,
      "private-prompt-digest",
      compilerVersion,
      privacyWorldTime,
    )
    .run();
  await atomicJoinDatabase.prepare(`INSERT INTO magic_world_entitlements (
      game_create_request_id, account_id, world_code, request_fingerprint,
      created_at, consumed_at, game_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      randomUUID(),
      privacyAccountId,
      appliedWorld.world.code,
      "f".repeat(64),
      privacyWorldTime,
      privacyWorldTime,
      privacyGame.id,
    )
    .run();
  await atomicJoinDatabase.batch([
    atomicJoinDatabase.prepare(`INSERT INTO magic_world_uses (
        game_id, world_code, spender_account_id, creator_account_id,
        qualifies_for_royalty, human_played_at, created_at
      ) SELECT ?, code, ?, creator_account_id, 1, ?, ?
        FROM magic_worlds WHERE code = ?`)
      .bind(
        privacyGame.id,
        privacyAccountId,
        privacyWorldTime,
        privacyWorldTime,
        appliedWorld.world.code,
      ),
    atomicJoinDatabase.prepare(`INSERT INTO magic_world_uses (
        game_id, world_code, spender_account_id, creator_account_id,
        qualifies_for_royalty, human_played_at, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)`)
      .bind(
        foreignPrivacyGame.id,
        appliedWorld.world.code,
        worldFanAccountId,
        privacyAccountId,
        foreignWorldTime,
        foreignWorldTime,
      ),
    atomicJoinDatabase.prepare(`INSERT INTO account_credit_ledger (
        id, account_id, amount, reason, source_key, world_code, game_id, created_at
      ) VALUES (?, ?, 1, 'world_royalty', ?, ?, ?, ?)`)
      .bind(
        `privacy-royalty:${privacyAccountId}`,
        privacyAccountId,
        `privacy-royalty:${privacyAccountId}`,
        appliedWorld.world.code,
        foreignPrivacyGame.id,
        foreignWorldTime,
      ),
  ]);
  const exportResponse = await request(runtime, "/api/me/export", {
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition") ?? "", /attachment/);
  const exported = await body(exportResponse);
  assert.equal(exported.account.username, usernameForAccount(privacyAccount));
  assert.equal(exported.account.tutorialStatus, "skipped");
  assert.deepEqual(exported.exportCompleteness, {
    complete: true,
    gameCount: exported.games.length,
    moveCount: exported.games.reduce((total, game) => total + game.moves.length, 0),
    creditLedgerCount: exported.credits.ledger.length
      + exported.credits.privateGameSummary.reduce(
        (total, summary) => total + summary.entryCount,
        0,
      ),
    worldSourceContributionCount: 1,
    worldEntitlementCount: 1,
    worldPaidUseCount: 1,
    worldCreatorPerformanceCount: 1,
  });
  assert.equal(exported.games.some((game) => game.id === privacyGame.id), true);
  assert.equal(
    exported.games.find((game) => game.id === privacyGame.id)?.worldCode,
    appliedWorld.world.code,
  );
  assert.deepEqual(exported.worldSourceContributions, [{
    worldCode: appliedWorld.world.code,
    parentCode: null,
    kind: "rediscover",
    createdAt: privacyWorldTime,
  }]);
  assert.deepEqual(exported.worldEntitlements, [{
    worldCode: appliedWorld.world.code,
    state: "consumed",
    createdAt: privacyWorldTime,
    consumedAt: privacyWorldTime,
    gameId: privacyGame.id,
  }]);
  assert.deepEqual(
    exported.worldUsesPaidByYou.find((use) => use.gameId === privacyGame.id),
    {
      worldCode: appliedWorld.world.code,
      gameId: privacyGame.id,
      qualifiedForRoyalty: true,
      humanPlayedAt: privacyWorldTime,
      createdAt: privacyWorldTime,
    },
  );
  assert.equal(
    exported.worldUsesPaidByYou.some((use) => use.gameId === foreignPrivacyGame.id),
    false,
  );
  assert.deepEqual(exported.worldCreatorPerformance, [{
    worldCode: appliedWorld.world.code,
    paidGames: 1,
    gamesWithHumanPlay: 1,
    qualifyingGames: 1,
    royaltyCreditsEarned: 1,
  }]);
  assert.deepEqual(exported.credits.privateGameSummary, [{
    reason: "world_royalty",
    worldCode: appliedWorld.world.code,
    amount: 1,
    entryCount: 1,
  }]);
  assert.equal(exported.games.some((game) => game.id === foreignPrivacyGame.id), false);
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(foreignPrivacyGame.id, "i"));
  assert.doesNotMatch(JSON.stringify(exported), new RegExp(foreignWorldTime));
  assert.equal(
    exported.games.find((game) => game.id === privacyRecapGame.id)?.publicRecapPath,
    privacyRecapPath,
  );
  assert.deepEqual(exported.featureAccess, {
    enabled: [],
    pendingRequests: [{
      feature: "magic_rules",
      requestedAt: privacyAccessPayload.requestedAt,
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(exported),
    /playerToken|seatToken|tokenHash|promptHash|requestFingerprint|sourceKey|accountId|private-prompt-digest/i,
  );
  const deleteResponse = await request(runtime, "/api/me/account", {
    method: "DELETE",
    accountEmail: privacyAccount.email,
    accountName: privacyAccount.displayName,
    body: JSON.stringify({ username: usernameForAccount(privacyAccount) }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.match(deleteResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await request(runtime, privacyRecapPath, { anonymous: true })).status, 404);
  const deletedGame = await atomicJoinDatabase
    .prepare("SELECT status, termination, white_name, black_name FROM games WHERE id = ?")
    .bind(privacyGame.id)
    .first();
  assert.deepEqual(
    {
      status: deletedGame.status,
      termination: deletedGame.termination,
      playerName: privacyColor === "w" ? deletedGame.white_name : deletedGame.black_name,
    },
    { status: "completed", termination: "cancelled", playerName: "Deleted player" },
  );
  const deletedSession = signedGoogleSession(privacyAccount.email, privacyAccount.displayName);
  const deletedSessionResponse = await runtime.dispatchFetch(`${origin}/api/auth/session`, {
    headers: { cookie: deletedSession.cookie, origin },
  });
  assert.deepEqual(await deletedSessionResponse.json(), {
    available: false,
    signedIn: false,
    deleted: true,
    needsUsername: false,
    account: null,
    features: { magicRules: false },
    featureRequests: { magicRules: null },
  });
  assert.deepEqual(
    await atomicJoinDatabase.prepare(`SELECT COUNT(*) AS count
      FROM feature_access_requests WHERE id = ?`)
      .bind(privacyAccessRow.id)
      .first(),
    { count: 0 },
  );

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
