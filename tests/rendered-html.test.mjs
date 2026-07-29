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

test("renders an identity-independent public homepage and guest play route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  const signedOutResponse = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(signedOutResponse.status, 200);
  const signedOutHtml = await signedOutResponse.text();
  assert.match(signedOutHtml, /REAL CHESS/);
  assert.match(signedOutHtml, /TOTAL PLAY/);
  assert.match(signedOutHtml, /href="\/app"/);
  assert.match(signedOutHtml, /href="\/demo"/);
  assert.match(
    signedOutHtml,
    /<a(?=[^>]*href="https:\/\/chat\.whatsapp\.com\/FaBgiUgl73vLdeqzcqx0vX")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>/,
  );
  assert.match(signedOutHtml, /JOIN THE COMMUNITY ON WHATSAPP/);
  assert.match(signedOutHtml, /<html(?![^>]*data-theme)[^>]*>/i);
  assert.doesNotMatch(signedOutHtml, /SIGN IN|Playing as|SWITCH ACCOUNT/i);
  assert.doesNotMatch(signedOutHtml, /Play chess/);
  assert.doesNotMatch(signedOutHtml, /aria-label="Choose visual theme"/);
  assert.doesNotMatch(signedOutHtml, /human check|captcha|turnstile/i);

  const signedInResponse = await worker.fetch(
    new Request("http://localhost/", { headers: signedPlayerHeaders("Ron Gross") }),
    renderEnv(),
    context,
  );
  assert.equal(signedInResponse.status, 200);
  assert.equal(await signedInResponse.text(), signedOutHtml);

  const appHostResponse = await worker.fetch(
    new Request("http://app.localhost/", {
      headers: { accept: "text/html", host: "app.localhost" },
    }),
    renderEnv(),
    context,
  );
  assert.equal(appHostResponse.status, 200);
  const appHostHtml = await appHostResponse.text();
  assert.match(appHostHtml, /Play chess/);
  assert.doesNotMatch(appHostHtml, /class="public-shell"/);
  assert.doesNotMatch(appHostHtml, /SIGN IN|Playing as|SWITCH ACCOUNT/i);
  assert.match(appHostHtml, /<html(?![^>]*data-theme)[^>]*>/i);

  const response = await worker.fetch(
    new Request("http://localhost/app", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot/);
  assert.match(html, /Play chess/);
  assert.match(html, /Your display name/);
  assert.doesNotMatch(html, /MOVE BOLDLY/);
  assert.doesNotMatch(html, /LEGAL CHESS|DRAG TO MOVE|SAVES EVERY MOVE/);
  assert.match(html, /WHAT&#x27;S NEW|WHAT'S NEW/);
  assert.doesNotMatch(html, /SIGN IN|Playing as|SWITCH ACCOUNT/i);
  assert.match(html, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(html, /aria-label="Choose visual theme"/);
  assert.match(html, /App updates/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(
    html,
    /<input(?=[^>]*name="game-mode")(?=[^>]*value="solo")(?=[^>]*checked)[^>]*>/,
  );
  assert.doesNotMatch(
    html,
    /<input(?=[^>]*name="game-mode")(?=[^>]*value="multiplayer")(?=[^>]*checked)[^>]*>/,
  );
  assert.match(html, /GAME MENU/);
  assert.match(html, /Choose a game/);
  assert.match(
    html,
    /<input(?=[^>]*name="game-variant")(?=[^>]*value="standard")(?=[^>]*checked)[^>]*>/,
  );
  assert.match(html, /Pawn Riot/);
  assert.match(html, /Half Army/);
  assert.match(html, /Pawn Duel/);
  assert.match(html, /Riot Bot level/);
  assert.doesNotMatch(html, /Time per move/);
  assert.match(html, /MAGIC RULES/);
  assert.match(html, /COMING SOON/);
  assert.doesNotMatch(html, /Describe the rule|magic-rule-prompt|INTERPRET RULES|COMPILE RULES/);
  assert.match(html, /Send feedback/);
  assert.match(html, /view issues or send a pull request on GitHub/);
  assert.doesNotMatch(html, /human check|captcha|turnstile/i);

  const gameResponse = await worker.fetch(
    new Request("http://localhost/g/00000000-0000-4000-8000-000000000000", {
      headers: { accept: "text/html" },
    }),
    renderEnv(),
    context,
  );
  assert.equal(gameResponse.status, 200);
  const gameHtml = await gameResponse.text();
  assert.match(gameHtml, /<html(?![^>]*data-theme)[^>]*>/i);
  assert.match(gameHtml, /aria-label="Choose visual theme"/);
  assert.match(gameHtml, /Classic/);
  assert.match(gameHtml, /Riot/);
  assert.match(
    gameHtml,
    /<a(?=[^>]*href="https:\/\/chat\.whatsapp\.com\/FaBgiUgl73vLdeqzcqx0vX")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>/,
  );
  assert.match(gameHtml, /JOIN WHATSAPP COMMUNITY/);
});

test("renders the narrated 90-second demo page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `demo-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/demo", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot in 90 seconds/);
  assert.match(html, /1:30 STORY/);
  assert.match(html, /SYNTHETIC NARRATION/);
  assert.match(html, /src="\/demo-assets\/chessriot-demo\.mp4"/);
  assert.match(html, /controls/);
  assert.match(html, /playsInline/);
  assert.match(html, /READ VIDEO TRANSCRIPT/);
  assert.match(html, /Ron and Omri love chess/);
  assert.match(html, /One game, still moving/);
  assert.doesNotMatch(html, /90 SECONDS\.<br/);
  assert.doesNotMatch(html, /Magic Rules/);
  assert.match(html, /The narration voice is synthetic/);
  assert.doesNotMatch(html, /INTERPRET RULES|COMPILE RULES/);
});

test("retires the old verification and human-check routes", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `verify-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };
  const env = renderEnv();

  const verifyResponse = await worker.fetch(
    new Request("http://localhost/verify?return_to=%2F", { redirect: "manual" }),
    env,
    context,
  );
  assert.ok([303, 307, 308].includes(verifyResponse.status));
  assert.equal(new URL(verifyResponse.headers.get("location"), "http://localhost").pathname, "/app");

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
  const currentVersionIndex = html.indexOf(`v${packageJson.version}`);
  assert.ok(currentVersionIndex >= 0);
  assert.ok(currentVersionIndex < html.indexOf("v0.3.5"));
  assert.ok(html.indexOf("v0.3.5") < html.indexOf("v0.3.4"));
  assert.ok(html.indexOf("v0.3.3") < html.indexOf("v0.3.2"));
  assert.ok(html.indexOf("v0.3.2") < html.indexOf("v0.3.1"));
  assert.ok(html.indexOf("v0.3.1") < html.indexOf("v0.3.0"));
  assert.match(html, /github\.com\/ripper234\/ChessRiot/);
});
