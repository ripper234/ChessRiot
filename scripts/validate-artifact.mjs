import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const packagePath = resolve(projectRoot, "package.json");
const packageLockPath = resolve(projectRoot, "package-lock.json");
const migrationPath = resolve(
  projectRoot,
  "dist/.openai/drizzle/0000_lazy_thunderbolt_ross.sql",
);

const [source, manifest, packageSource, packageLockSource, migration] =
  await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(packageLockPath, "utf8"),
  readFile(migrationPath, "utf8"),
  ]);
const hostingManifest = JSON.parse(manifest);
assert.equal(hostingManifest.d1, "DB");
assert.match(migration, /CREATE TABLE `deployment_registry`/);
const packageVersion = JSON.parse(packageSource).version;
const packageLock = JSON.parse(packageLockSource);
assert.equal(packageLock.version, packageVersion);
assert.equal(packageLock.packages[""].version, packageVersion);

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
assert.match(page, /Code changes deploy automatically to Development/);
assert.match(page, /Staging and Production move only after your explicit promotion click/);
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
assert.match(script, /latest successful environment check/);
assert.match(script, /LOADING DEPLOYMENT STATE/);
assert.match(script, /MANUALLY PROMOTE FROM/);
assert.match(script, /AUTO-DEPLOYED FROM CODE/);
assert.match(script, /WAITING FOR DEV AUTO-DEPLOY/);
assert.match(script, /Manual only: your click promotes/);
assert.match(script, /pipeline-open/);
assert.match(script, /OPEN " \+ stage\.label \+ " ↗"/);
assert.match(script, /if \(!stage\.latest\)/);
assert.match(script, /open\.href = stage\.url/);
assert.match(script, /open\.target = "_blank"/);
assert.match(script, /open\.rel = "noopener noreferrer"/);
assert.match(script, /"Open " \+ stage\.label \+ " environment"/);
assert.match(script, /connecting\.disabled = true/);
assert.match(script, /connecting\.textContent = "CONNECTING…"/);
assert.doesNotMatch(script, /PREPARE DEPLOY LATEST/);
assert.doesNotMatch(script, /openRequest\(latestVersion/);
assert.match(script, /snapshot\.loading = true/);
assert.doesNotMatch(script, /if \(cached\) snapshot\.loading = false/);

const forbiddenAutomaticPromotion = await workerModule.default.fetch(
  new Request("https://control.test/api/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "development", to: "staging" }),
  }),
  {},
  {},
);
assert.equal(forbiddenAutomaticPromotion.status, 404);
assert.doesNotMatch(script, /fetch\([^)]*\/api\/(?:promote|deploy)/);

class FakeD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new FakeD1Statement(this.database, this.sql, bindings);
  }

  async run() {
    if (/CREATE TABLE IF NOT EXISTS deployment_registry/.test(this.sql)) {
      return { success: true };
    }
    if (/INSERT INTO deployment_registry/.test(this.sql)) {
      const [environment, version, deployedAt, verifiedAt, updatedAt] = this.bindings;
      const current = this.database.rows.get(environment);
      if (!current) {
        this.database.rows.set(environment, {
          environment,
          deployed_version: version,
          deployed_at: deployedAt,
          verified_at: verifiedAt,
          runtime_version: null,
          health_state: "unknown",
          health_status: null,
          database_status: null,
          last_health_at: null,
          last_checked_at: null,
          updated_at: updatedAt,
        });
      } else if (
        verifiedAt &&
        (!current.verified_at || verifiedAt > current.verified_at)
      ) {
        const changedVersion = current.deployed_version !== version;
        Object.assign(current, {
          deployed_version: version,
          deployed_at: deployedAt || current.deployed_at,
          verified_at: verifiedAt,
          runtime_version: changedVersion ? null : current.runtime_version,
          health_state: changedVersion ? "unknown" : current.health_state,
          health_status: changedVersion ? null : current.health_status,
          database_status: changedVersion ? null : current.database_status,
          last_health_at: changedVersion ? null : current.last_health_at,
          last_checked_at: changedVersion ? null : current.last_checked_at,
          updated_at: updatedAt,
        });
      }
      return { success: true };
    }
    if (/UPDATE deployment_registry/.test(this.sql)) {
      const [
        deployedVersion,
        deployedAt,
        verifiedAt,
        runtimeVersion,
        healthState,
        healthStatus,
        databaseStatus,
        lastHealthAt,
        lastCheckedAt,
        updatedAt,
        environment,
      ] = this.bindings;
      const current = this.database.rows.get(environment);
      assert.ok(current, `Missing fake registry row for ${environment}`);
      Object.assign(current, {
        deployed_version: deployedVersion,
        deployed_at: deployedAt,
        verified_at: verifiedAt,
        runtime_version: runtimeVersion,
        health_state: healthState,
        health_status: healthStatus,
        database_status: databaseStatus,
        last_health_at: lastHealthAt,
        last_checked_at: lastCheckedAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    throw new Error(`Unsupported fake D1 run: ${this.sql}`);
  }

  async all() {
    if (/FROM deployment_registry/.test(this.sql)) {
      return { results: [...this.database.rows.values()].map((row) => ({ ...row })) };
    }
    throw new Error(`Unsupported fake D1 all: ${this.sql}`);
  }

  async first() {
    if (/FROM deployment_registry/.test(this.sql)) {
      const row = this.database.rows.get(this.bindings[0]);
      return row ? { ...row } : null;
    }
    throw new Error(`Unsupported fake D1 first: ${this.sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

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
assert.equal(status.releases[0].version, "0.4.0");

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
    { key: "development", deployedVersion: "0.4.0" },
    { key: "staging", deployedVersion: "0.3.3" },
    { key: "production", deployedVersion: "0.3.3" },
  ],
);

const database = new FakeD1();
const persistentEnv = {
  DB: database,
  PROD_DEPLOYED_VERSION: "0.3.2",
  STAGING_DEPLOYED_VERSION: "0.3.2",
  DEV_DEPLOYED_VERSION: "0.3.2",
  DEPLOYMENT_STATE_JSON: JSON.stringify({
    environments: {
      development: {
        version: "0.3.2",
        deployedAt: "2026-07-24T14:20:00.000Z",
        verifiedAt: "2026-07-24T14:20:00.000Z",
      },
      staging: {
        version: "0.3.2",
        deployedAt: "2026-07-24T14:21:00.000Z",
        verifiedAt: "2026-07-24T14:21:00.000Z",
      },
      production: {
        version: "0.3.2",
        deployedAt: "2026-07-24T14:22:00.000Z",
        verifiedAt: "2026-07-24T14:22:00.000Z",
      },
    },
  }),
};
const seededResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  persistentEnv,
  {},
);
const seeded = await seededResponse.json();
assert.equal(seeded.registryPersistence, "d1");
assert.equal(seeded.environments[0].deployedVersion, "0.3.2");

const successfulObservationResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/registry/observation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-control-observation": "browser-health-v1",
    },
    body: JSON.stringify({
      environment: "development",
      healthState: "fresh",
      runtimeVersion: "0.3.3",
      healthStatus: "ok",
      databaseStatus: "ok",
    }),
  }),
  persistentEnv,
  {},
);
assert.equal(successfulObservationResponse.status, 200);
const successfulObservation = await successfulObservationResponse.json();
assert.equal(successfulObservation.deployedVersion, "0.3.3");
assert.ok(successfulObservation.lastHealthAt);

const failedObservationResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/registry/observation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-control-observation": "browser-health-v1",
    },
    body: JSON.stringify({
      environment: "development",
      healthState: "network",
      runtimeVersion: null,
      healthStatus: null,
      databaseStatus: null,
    }),
  }),
  persistentEnv,
  {},
);
assert.equal(failedObservationResponse.status, 200);
const failedObservation = await failedObservationResponse.json();
assert.equal(failedObservation.deployedVersion, "0.3.3");
assert.equal(failedObservation.lastHealthAt, successfulObservation.lastHealthAt);

const persistedResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  persistentEnv,
  {},
);
const persisted = await persistedResponse.json();
assert.equal(persisted.environments[0].deployedVersion, "0.3.3");
assert.equal(
  persisted.environments[0].lastKnownHealth.lastHealthAt,
  successfulObservation.lastHealthAt,
);
assert.equal(persisted.latestVersion, "0.4.0");

const promotedEnv = {
  ...persistentEnv,
  DEV_DEPLOYED_VERSION: "0.3.4",
  DEPLOYMENT_STATE_JSON: JSON.stringify({
    environments: {
      development: {
        version: "0.3.4",
        deployedAt: "2026-07-25T10:00:00.000Z",
        verifiedAt: "2026-07-25T10:01:00.000Z",
      },
    },
  }),
};
const promotedResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  promotedEnv,
  {},
);
const promoted = await promotedResponse.json();
assert.equal(promoted.environments[0].deployedVersion, "0.3.4");
assert.equal(promoted.environments[0].lastKnownHealth.runtimeVersion, null);
assert.equal(promoted.latestVersion, "0.4.0");

const reconciliationDb = new FakeD1();
const oldRegistryEnv = {
  DB: reconciliationDb,
  PROD_DEPLOYED_VERSION: "0.3.2",
  STAGING_DEPLOYED_VERSION: "0.3.2",
  DEV_DEPLOYED_VERSION: "0.3.2",
  DEPLOYMENT_STATE_JSON: JSON.stringify({
    environments: Object.fromEntries(
      ["development", "staging", "production"].map((environment) => [
        environment,
        {
          version: "0.3.2",
          deployedAt: "2026-07-24T14:20:00.000Z",
          verifiedAt: "2026-07-24T14:20:00.000Z",
        },
      ]),
    ),
  }),
};
await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  oldRegistryEnv,
  {},
);
const reconciledEnv = {
  ...oldRegistryEnv,
  PROD_DEPLOYED_VERSION: "0.3.3",
  STAGING_DEPLOYED_VERSION: "0.3.3",
  DEV_DEPLOYED_VERSION: "0.3.3",
  DEPLOYMENT_STATE_JSON: JSON.stringify({
    environments: Object.fromEntries(
      ["development", "staging", "production"].map((environment) => [
        environment,
        {
          version: "0.3.3",
          deployedAt: "2026-07-24T15:00:00.000Z",
          verifiedAt: "2026-07-24T15:01:00.000Z",
        },
      ]),
    ),
  }),
};
const reconciledResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  reconciledEnv,
  {},
);
const reconciled = await reconciledResponse.json();
assert.deepEqual(
  reconciled.environments.map(({ deployedVersion }) => deployedVersion),
  ["0.3.3", "0.3.3", "0.3.3"],
);

console.log("Artifact is valid ESM and exports default.fetch");
