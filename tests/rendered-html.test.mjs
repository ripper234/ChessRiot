import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const accountIdSecret = "render-account-id-secret";

function signedPlayerHeaders(name = "Render Player") {
  const email = "render-player@players.chessriot.test";
  return {
    accept: "text/html",
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(name),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
}

function renderEnv() {
  return {
    CHESSRIOT_ENV: "test",
    ACCOUNT_ID_SECRET: accountIdSecret,
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
  assert.doesNotMatch(signedOutHtml, /human check|captcha|turnstile/i);

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
  assert.doesNotMatch(html, /human check|captcha|turnstile/i);
});

test("retires the human-check route and sends signed-in players straight back", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `verify-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  const env = renderEnv();

  const verifyResponse = await worker.fetch(
    new Request("http://localhost/verify?return_to=%2F", {
      headers: signedPlayerHeaders(),
      redirect: "manual",
    }),
    env,
    context,
  );
  assert.ok([303, 307, 308].includes(verifyResponse.status));
  assert.equal(new URL(verifyResponse.headers.get("location"), "http://localhost").pathname, "/");

  const retiredRoute = await worker.fetch(
    new Request("http://localhost/api/auth/captcha", {
      method: "POST",
      headers: signedPlayerHeaders(),
    }),
    env,
    context,
  );
  assert.equal(retiredRoute.status, 404);
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
