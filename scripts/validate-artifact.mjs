import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

const pageResponse = await workerModule.default.fetch(
  new Request("https://control.test/"),
  {},
  {},
);
const page = await pageResponse.text();
assert.match(page, /CONTROL v0\.1\.3/);
assert.match(page, /AUTO CHECK · 5 MIN/);
assert.match(page, /Last updated/);
assert.match(page, /refreshIntervalMs = 300000/);
assert.match(page, /probeTimeoutMs = 15000/);
assert.match(page, /probeStylesheet/);
assert.match(page, /mode: "no-cors"/);
assert.match(page, /setInterval\(\(\) => void loadStatus\(\), refreshIntervalMs\)/);
assert.doesNotMatch(page, /REFRESH STATUS/);
assert.doesNotMatch(page, /id="refresh"/);

const statusResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  {
    PROD_URL: "https://prod.test",
    STAGING_URL: "https://staging.test",
    DEV_URL: "https://dev.test",
  },
  {},
);
const status = await statusResponse.json();
assert.equal(status.controlVersion, "0.1.3");
assert.deepEqual(status.releaseAssets, {
  "0.1.0": "/assets/index-ltKYg5gI.css",
  "0.1.1": "/assets/index-BIvHkimP.css",
});
assert.deepEqual(
  status.environments.map(({ key, expectedVersion, url }) => ({
    key,
    expectedVersion,
    url,
  })),
  [
    {
      key: "production",
      expectedVersion: "0.1.0",
      url: "https://prod.test",
    },
    {
      key: "staging",
      expectedVersion: "0.1.1",
      url: "https://staging.test",
    },
    {
      key: "development",
      expectedVersion: "0.1.1",
      url: "https://dev.test",
    },
  ],
);

console.log("Artifact is valid ESM and exports default.fetch");
