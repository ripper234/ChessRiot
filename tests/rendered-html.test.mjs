import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("renders the ChessRiot home page", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ChessRiot/);
  assert.match(html, /Play chess/);
  assert.doesNotMatch(html, /MOVE BOLDLY/);
  assert.doesNotMatch(html, /LEGAL CHESS|DRAG TO MOVE|SAVES EVERY MOVE/);
  assert.match(html, /WHAT&#x27;S NEW|WHAT'S NEW/);
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
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
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
