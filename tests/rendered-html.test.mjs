import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const accountIdSecret = "render-account-id-secret";
const sessionSigningSecret = "render-session-secret";

function signedPlayerHeaders(name = "Render Player") {
  const email = "render-player@players.chessriot.test";
  const accountId = createHmac("sha256", accountIdSecret)
    .update(email)
    .digest("base64url");
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: accountId,
    exp: Math.floor(Date.now() / 1000) + 3_600,
  })).toString("base64url");
  const signature = createHmac("sha256", sessionSigningSecret)
    .update(payload)
    .digest("base64url");
  return {
    accept: "text/html",
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    cookie: `__Host-chessriot-access=${payload}.${signature}`,
  };
}

function renderEnv() {
  return {
    CHESSRIOT_ENV: "test",
    ACCOUNT_ID_SECRET: accountIdSecret,
    SESSION_SIGNING_SECRET: sessionSigningSecret,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

test("requires an account before showing the game creator", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const signedOutResponse = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(signedOutResponse.status, 200);
  const signedOutHtml = await signedOutResponse.text();
  assert.match(signedOutHtml, /Your board is waiting/);
  assert.match(signedOutHtml, /SIGN IN TO PLAY/);
  assert.doesNotMatch(signedOutHtml, /Play chess/);

  const response = await worker.fetch(
    new Request("http://localhost/", { headers: signedPlayerHeaders() }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot/);
  assert.match(html, /Play chess/);
  assert.doesNotMatch(html, /MOVE BOLDLY/);
  assert.doesNotMatch(html, /LEGAL CHESS|DRAG TO MOVE|SAVES EVERY MOVE/);
  assert.match(html, /WHAT&#x27;S NEW|WHAT'S NEW/);
  assert.match(html, /SWITCH ACCOUNT/);
  assert.match(html, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(html, /aria-label="Choose visual theme"/);
  assert.match(html, /App updates and notifications/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /Time per move/);
  assert.match(html, /Three days is the default/);
  assert.match(html, /localStorage\.getItem/);
  for (const theme of [
    "Classic",
    "Ocean",
    "Blockfield",
    "Toybox",
    "Arena Pop",
    "High Fantasy",
    "Arcane Cards",
    "Iron Legions",
    "Shadow Shogun",
    "Neon Grid",
    "Mono",
  ]) {
    assert.match(html, new RegExp(theme));
  }
  assert.match(html, /Send feedback/);
  assert.match(html, /view issues or send a pull request on GitHub/);
});

test("renders the newest-first public changelog", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `changelog-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/changelog", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WHAT.*NEW/);
  assert.ok(html.indexOf(`v${packageJson.version}`) < html.indexOf("v0.3.5"));
  assert.ok(html.indexOf("v0.3.5") < html.indexOf("v0.3.4"));
  assert.ok(html.indexOf("v0.3.3") < html.indexOf("v0.3.2"));
  assert.ok(html.indexOf("v0.3.2") < html.indexOf("v0.3.1"));
  assert.ok(html.indexOf("v0.3.1") < html.indexOf("v0.3.0"));
  assert.match(html, /github\.com\/ripper234\/ChessRiot/);
});
