import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const packagePath = resolve(projectRoot, "package.json");

const [source, manifest, packageSource] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(packagePath, "utf8"),
]);
JSON.parse(manifest);
const packageVersion = JSON.parse(packageSource).version;

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
assert.match(page, new RegExp(`CONTROL v${packageVersion.replace(/\./g, "\\.")}`));
assert.match(page, /AUTO CHECK · 5 MIN/);
assert.match(page, /OBSERVABILITY/);
assert.match(page, /script src="\/control\.js"/);
assert.doesNotMatch(page, /script-src 'unsafe-inline'/);

const scriptResponse = await workerModule.default.fetch(
  new Request("https://control.test/control.js"),
  {},
  {},
);
const script = await scriptResponse.text();
assert.match(script, /\/api\/health/);
assert.match(script, /\/api\/ops\/overview/);
assert.match(script, /content-type": "text\/plain"/);
assert.match(script, /setInterval\(function \(\) \{ void loadStatus\(\); \}, 300000\)/);
assert.doesNotMatch(script, /REFRESH STATUS/);

const statusResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  {
    PROD_URL: "https://prod.test",
    STAGING_URL: "https://staging.test",
    DEV_URL: "https://dev.test",
    PROD_OPS_READ_SECRET: "prod-secret-with-at-least-32-characters",
    STAGING_OPS_READ_SECRET: "staging-secret-with-at-least-32-characters",
    DEV_OPS_READ_SECRET: "dev-secret-with-at-least-32-characters",
  },
  {},
);
const status = await statusResponse.json();
assert.equal(status.controlVersion, packageVersion);
assert.equal(status.refreshIntervalMs, 300000);
assert.deepEqual(
  status.environments.map(({ key, expectedVersion, url, grant }) => ({
    key,
    expectedVersion,
    url,
    hasGrant: typeof grant === "string" && grant.includes("."),
  })),
  [
    {
      key: "production",
      expectedVersion: "0.2.2",
      url: "https://prod.test",
      hasGrant: true,
    },
    {
      key: "staging",
      expectedVersion: "0.2.2",
      url: "https://staging.test",
      hasGrant: true,
    },
    {
      key: "development",
      expectedVersion: "0.2.2",
      url: "https://dev.test",
      hasGrant: true,
    },
  ],
);

console.log("Artifact is valid ESM and exports default.fetch");
