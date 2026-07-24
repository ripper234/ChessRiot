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
assert.match(page, /Version history/);
assert.match(page, /Development → Staging → Production/);
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
assert.match(script, /credentials: item\.access === "Owner only" \? "include" : "omit"/);
assert.match(script, /const requestTimeoutMs = 15000/);
assert.match(
  script,
  /const inspectionResults = await Promise\.allSettled\(/,
);
assert.doesNotMatch(script, /No successful health response/);
assert.doesNotMatch(script, /\bUNAVAILABLE\b|\bUNDEPLOYED\b/i);
assert.doesNotMatch(script, /UNDEPLOYED|UNAVAILABLE/);
assert.match(script, /AbortController/);
assert.match(script, /sessionStorage/);
assert.match(script, /COULD NOT VERIFY/);
assert.match(script, /Deployment state is unaffected/);
assert.match(script, /lastSuccessfulAt/);
assert.match(script, /last live success/);

const statusResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  {
    PROD_URL: "https://prod.test",
    STAGING_URL: "https://staging.test",
    DEV_URL: "https://dev.test",
    PROD_OPS_READ_SECRET: "prod-secret-with-at-least-32-characters",
    STAGING_OPS_READ_SECRET: "staging-secret-with-at-least-32-characters",
    DEV_OPS_READ_SECRET: "dev-secret-with-at-least-32-characters",
    PROD_DEPLOYED_VERSION: "0.2.2",
    STAGING_DEPLOYED_VERSION: "0.3.0",
    DEV_DEPLOYED_VERSION: "0.3.2",
    DEPLOYMENT_STATE_JSON: JSON.stringify({
      environments: {
        development: {
          version: "0.3.2",
          deployedAt: "2026-07-24T14:00:00.000Z",
          verifiedAt: "2026-07-24T14:01:00.000Z",
        },
        staging: {
          version: "0.3.0",
          deployedAt: "2026-07-24T13:00:00.000Z",
          verifiedAt: "2026-07-24T13:01:00.000Z",
        },
        production: {
          version: "0.2.2",
          deployedAt: "2026-07-24T12:00:00.000Z",
          verifiedAt: "2026-07-24T12:01:00.000Z",
        },
      },
    }),
  },
  {},
);
const status = await statusResponse.json();
assert.equal(status.controlVersion, packageVersion);
assert.equal(status.refreshIntervalMs, 300000);
assert.deepEqual(
  status.environments.map(({ key, deployedVersion, url, grant }) => ({
    key,
    deployedVersion,
    url,
    hasGrant: typeof grant === "string" && grant.includes("."),
  })),
  [
    {
      key: "development",
      deployedVersion: "0.3.2",
      url: "https://dev.test",
      hasGrant: true,
    },
    {
      key: "staging",
      deployedVersion: "0.3.0",
      url: "https://staging.test",
      hasGrant: true,
    },
    {
      key: "production",
      deployedVersion: "0.2.2",
      url: "https://prod.test",
      hasGrant: true,
    },
  ],
);
assert.equal(status.releases[0].version, "0.3.2");

const fallbackResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  {},
  {},
);
const fallbackStatus = await fallbackResponse.json();
assert.deepEqual(
  fallbackStatus.environments.map(({ key, deployedVersion }) => ({
    key,
    deployedVersion,
  })),
  [
    { key: "development", deployedVersion: "0.3.2" },
    { key: "staging", deployedVersion: "0.2.2" },
    { key: "production", deployedVersion: "0.2.2" },
  ],
);

console.log("Artifact is valid ESM and exports default.fetch");
