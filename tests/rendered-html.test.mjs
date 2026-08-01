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
  assert.equal(signedOutResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(signedOutResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(signedOutResponse.headers.get("strict-transport-security"), null);
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

  const secureResponse = await worker.fetch(
    new Request("https://chessriot.gg/", { headers: { accept: "text/html" } }),
    renderEnv(),
    context,
  );
  assert.equal(secureResponse.status, 200);
  assert.equal(secureResponse.headers.get("strict-transport-security"), "max-age=86400");
  assert.doesNotMatch(
    secureResponse.headers.get("strict-transport-security") ?? "",
    /includeSubDomains/i,
  );

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
  assert.match(
    html,
    /<input(?=[^>]*id="display-name")(?=[^>]*required)(?=[^>]*aria-invalid="false")[^>]*>/,
  );
  assert.doesNotMatch(html, /MOVE BOLDLY/);
  assert.doesNotMatch(html, /LEGAL CHESS|DRAG TO MOVE|SAVES EVERY MOVE/);
  assert.match(html, /WHAT&#x27;S NEW|WHAT'S NEW/);
  assert.doesNotMatch(html, /SIGN IN|Playing as|SWITCH ACCOUNT/i);
  assert.match(html, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}`));
  assert.match(html, /Open ChessRiot menu/);
  assert.match(html, /skin/i);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /https:\/\/chessriot\.gg\/(?:manifest|icons)\//);
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
  assert.match(html, /Mating Set/);
  assert.match(html, /Pawn Promotion/);
  assert.match(html, /Rook Mate/);
  assert.match(html, /Two-Bishop Mate/);
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
  assert.match(gameHtml, /Open ChessRiot menu/);
  assert.match(gameHtml, /Appearance and skin/);
  assert.doesNotMatch(gameHtml, /name="menu-theme"/);
  assert.doesNotMatch(gameHtml, /class="global-version"/);
  assert.doesNotMatch(gameHtml, /LOCKING MOVE/);
  assert.match(
    gameHtml,
    /<a(?=[^>]*href="https:\/\/chat\.whatsapp\.com\/FaBgiUgl73vLdeqzcqx0vX")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>/,
  );
  assert.match(gameHtml, /JOIN WHATSAPP COMMUNITY/);
});

test("renders the production capture lab and keeps combat non-blocking", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `capture-lab-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/capture-lab", { headers: { accept: "text/html" } }),
    renderEnv(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /EVERY PIECE/);
  assert.match(html, /FIGHTS DIFFERENT/);
  assert.match(html, /Sword slash/);
  assert.match(html, /SIMULATE REDUCED MOTION/);

  const gameRoomSource = readFileSync(
    new URL("../app/ui/GameRoom.tsx", import.meta.url),
    "utf8",
  );
  const combatStyles = readFileSync(
    new URL("../app/combat.css", import.meta.url),
    "utf8",
  );
  assert.match(gameRoomSource, /<BoardActionAnimation/);
  assert.match(gameRoomSource, /dismissBoardEffects/);
  assert.doesNotMatch(gameRoomSource, /aria-busy=.*activeEffect/);
  assert.doesNotMatch(gameRoomSource, /disabled=.*activeEffect/);
  for (const piece of ["p", "n", "b", "r", "q", "k"]) {
    assert.match(combatStyles, new RegExp(`data-attacker=\\"${piece}\\"`));
  }
});

test("keeps the version inside the unified menu and no locking label", () => {
  const gameRoomSource = readFileSync(
    new URL("../app/ui/GameRoom.tsx", import.meta.url),
    "utf8",
  );
  const routeChromeSource = readFileSync(
    new URL("../app/ui/RouteChrome.tsx", import.meta.url),
    "utf8",
  );
  const globalStyles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const healthSource = readFileSync(
    new URL("../app/api/health/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gameRoomSource, /game-version/);
  assert.doesNotMatch(gameRoomSource, /LOCKING MOVE/);
  assert.match(
    gameRoomSource,
    /surrenderDialog\.current\?\.close\(\);[\s\S]*setSurrendering\(true\)/,
  );
  assert.match(gameRoomSource, /aria-controls="coach-risk-explanation"/);
  assert.match(gameRoomSource, /const surrenderKeepPlaying = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(
    gameRoomSource,
    /dialog\.showModal\(\);\s*surrenderKeepPlaying\.current\?\.focus\(\)/,
  );
  assert.match(gameRoomSource, /ref=\{surrenderKeepPlaying\}/);
  assert.doesNotMatch(routeChromeSource, /global-version/);
  assert.match(routeChromeSource, /<AppUpdates/);
  assert.match(globalStyles, /surrender-confirm/);
  assert.match(globalStyles, /\.privacy-shell > \.topbar/);
  assert.doesNotMatch(globalStyles, /\.move-confirm-card > div/);
  assert.doesNotMatch(healthSource, /ensureSchema/);
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

test("publishes crawler policy and a working favicon route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `public-metadata-${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const context = { waitUntil() {}, passThroughOnException() {} };

  const robots = await worker.fetch(
    new Request("http://localhost/robots.txt"),
    renderEnv(),
    context,
  );
  assert.equal(robots.status, 200);
  const policy = await robots.text();
  assert.match(policy, /Disallow: \/api\//);
  assert.match(policy, /Disallow: \/g\//);
  assert.match(policy, /Disallow: \/verify/);
  assert.match(policy, /Sitemap: https:\/\/chessriot\.gg\/sitemap\.xml/);

  const favicon = await worker.fetch(
    new Request("http://localhost/favicon.ico", { redirect: "manual" }),
    renderEnv(),
    context,
  );
  assert.equal(favicon.status, 308);
  assert.equal(new URL(favicon.headers.get("location")).pathname, "/icons/chessriot-192.png");
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
  const normalizedHtml = html.replaceAll("<!-- -->", "");
  const currentVersionIndex = normalizedHtml.indexOf(`v${packageJson.version}`);
  assert.ok(currentVersionIndex >= 0);
  for (const version of ["v0.3.5", "v0.3.4", "v0.3.3", "v0.3.2", "v0.3.1"]) {
    assert.ok(normalizedHtml.indexOf(version) >= 0);
  }
  assert.ok(currentVersionIndex < normalizedHtml.indexOf("v0.3.5"));
  assert.ok(normalizedHtml.indexOf("v0.3.5") < normalizedHtml.indexOf("v0.3.4"));
  assert.ok(normalizedHtml.indexOf("v0.3.3") < normalizedHtml.indexOf("v0.3.2"));
  assert.ok(normalizedHtml.indexOf("v0.3.2") < normalizedHtml.indexOf("v0.3.1"));
  assert.ok(normalizedHtml.indexOf("v0.3.1") < normalizedHtml.indexOf("v0.3.0"));
  assert.match(html, /github\.com\/ripper234\/ChessRiot/);
});
