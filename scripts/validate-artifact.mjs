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
const financialMigrationPath = resolve(
  projectRoot,
  "dist/.openai/drizzle/0001_many_phil_sheldon.sql",
);
const financialOutcomeMigrationPath = resolve(
  projectRoot,
  "dist/.openai/drizzle/0002_slow_trish_tilby.sql",
);

const [
  source,
  manifest,
  packageSource,
  packageLockSource,
  migration,
  financialMigration,
  financialOutcomeMigration,
] =
  await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(packageLockPath, "utf8"),
  readFile(migrationPath, "utf8"),
  readFile(financialMigrationPath, "utf8"),
  readFile(financialOutcomeMigrationPath, "utf8"),
  ]);
const hostingManifest = JSON.parse(manifest);
assert.equal(hostingManifest.d1, "DB");
assert.match(migration, /CREATE TABLE `deployment_registry`/);
assert.match(financialMigration, /CREATE TABLE `ai_usage_events`/);
assert.match(financialMigration, /ai_usage_events_source_event_unique/);
assert.match(financialOutcomeMigration, /ADD `outcome` text/);
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
assert.match(source, /feedback:manage/);

const pageResponse = await workerModule.default.fetch(
  new Request("https://control.test/"),
  {},
  {},
);
const page = await pageResponse.text();
assert.match(page, new RegExp(`CONTROL v${packageVersion.replace(/\./g, "\\.")}`));
assert.match(page, /AUTO CHECK · 5 MIN/);
assert.match(page, /<h1>Release pipeline<\/h1>/);
assert.match(
  page,
  /\.pipeline-node b\{[^}]*width:calc\(100% \+ 12px\)[^}]*margin:7px -6px 12px[^}]*padding:2px 6px 3px[^}]*overflow:hidden[^}]*font:italic clamp\(20px,2\.2vw,24px\)\/1\.15/,
);
assert.match(
  page,
  /\.pipeline-node b\{font-size:clamp\(22px,7vw,24px\)\}/,
);
assert.match(
  page,
  /grid-template-columns:minmax\(140px,1fr\) 116px minmax\(140px,1fr\)/,
);
assert.doesNotMatch(page, /pipeline-node\.latest|pipeline-action\.auto/);
assert.match(page, /Environment health/);
assert.match(page, /id="financial-dashboard"/);
assert.match(page, /AI cost &amp; waste/);
assert.match(page, /Development \/ build waste/);
assert.match(page, /Runtime waste by cause/);
assert.match(page, /By game version/);
assert.match(page, /NOT INSTRUMENTED/);
assert.doesNotMatch(page, /Feature previews|runtime-magic-rules|magic-preview/);
assert.match(page, /Recent events/);
assert.match(page, /id="feedback-launcher"/);
assert.match(page, /aria-controls="feedback-inbox"/);
assert.match(page, /<dialog class="feedback-inbox-dialog" id="feedback-inbox"/);
assert.match(page, /id="feedback-completed"/);
assert.doesNotMatch(page, /id="feedback-count"|<details class="drawer feedback"/);
assert.match(page, /Direct deployment is not connected/);
assert.match(page, /active controls prepare a manual ChatGPT Work request/);
assert.match(
  page,
  /https:\/\/chessriot\.gg\/changelog/,
);
assert.match(page, /https:\/\/dev\.chessriot\.gg\/demo/);
assert.doesNotMatch(page, /ripper234\.chatgpt\.site/);
assert.doesNotMatch(page, /Version history|CONTROL \+ GAME|ADVANCED VERSIONS/);
assert.doesNotMatch(page, /<details[^>]*\sopen(?:\s|>)/);
assert.match(page, /<dialog id="release-handoff"/);
assert.match(page, /COPY WORK REQUEST/);
assert.match(page, /OPEN CHATGPT/);
assert.match(page, /temporary manual handoff, not deployment automation/);
assert.match(page, /script src="\/control\.js"/);
assert.doesNotMatch(page, /script-src 'unsafe-inline'/);

const scriptResponse = await workerModule.default.fetch(
  new Request("https://control.test/control.js"),
  {},
  {},
);
const script = await scriptResponse.text();
assert.doesNotMatch(script, /\bENVIRONMENTS\b/);
assert.match(script, /\/api\/health/);
assert.match(script, /\/api\/ops\/overview/);
assert.match(script, /\/api\/financials\?window=/);
assert.match(script, /function renderFinancials/);
assert.match(script, /Historical build totals cannot be reconstructed/);
assert.doesNotMatch(script, /inputTokens \+ cachedInputTokens/);
assert.match(
  script,
  /"\/api\/ops\/feedback\/" \+ encodeURIComponent\(feedbackId\) \+ "\/close"/,
);
assert.match(script, /fetchFreshStatusEnvironment\(environmentKey\)/);
assert.match(script, /MARK DONE UNAVAILABLE/);
assert.match(script, /summary\.complete && summary\.known === 0/);
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
assert.doesNotMatch(script, /\bUNDEPLOYED\b/i);
assert.match(script, /AbortController/);
assert.doesNotMatch(script, /sessionStorage|fallbackVersion/);
assert.match(script, /COULD NOT VERIFY/);
assert.match(script, /Could not verify a current version/);
assert.match(script, /function verifiedVersion/);
assert.doesNotMatch(script, /deployedVersion|lastKnownHealth|verifiedAt/);
assert.doesNotMatch(
  script,
  /telemetryFresh[\s\S]{0,180}overview\.version/,
);
assert.doesNotMatch(script, /LATEST IN DEV|developmentVersion|AUTO TARGET/);
assert.match(script, /label: "DEV · AUTO LATEST"/);
assert.match(script, /label: "PROD"/);
assert.doesNotMatch(script, /label: "STAGING"|key: "staging"/);
assert.doesNotMatch(script, /stage\.key === "development"/);
assert.match(script, /window\.addEventListener\("pageshow"/);
assert.match(script, /if \(event\.persisted\) void loadStatus\(\)/);
assert.match(
  script,
  /version\.textContent = stage\.version \? "v" \+ stage\.version : "—"/,
);
assert.doesNotMatch(script, /Not recorded|STALE HEALTH|Showing last good/);
assert.match(script, /lastSuccessfulAt/);
assert.match(script, /latest successful environment check/);
assert.match(script, /pipeline-connector/);
assert.match(script, /PREPARE PROMOTE v/);
assert.match(script, /action\.disabled = true/);
assert.match(script, /action\.classList\.add\("promote"\)/);
assert.match(script, /action\.dataset\.promotion = source\.key \+ "-to-" \+ stage\.key/);
assert.match(script, /openPromotionHandoff\(source, stage\)/);
assert.doesNotMatch(script, /PROMOTE[^"\n]*→/);
assert.equal((script.match(/arrow\.textContent = "→"/g) || []).length, 1);
assert.match(script, /VERIFY \/ SYNC v/);
assert.match(script, /verify or synchronize the exact build/);
assert.doesNotMatch(script, /already v/);
assert.match(script, /ChatGPT Work handoff/);
assert.match(script, /Control will not deploy anything/);
assert.match(script, /pipeline-open/);
assert.match(script, /SWITCH VERSION…/);
assert.match(script, /buildWorkRequest/);
assert.match(script, /Promote ChessRiot v/);
assert.match(script, /Roll back ChessRiot/);
assert.match(script, /Upgrade ChessRiot/);
assert.match(
  script,
  /return action \+ "\\nExecute and verify the deployment\."/,
);
assert.doesNotMatch(script, /Requirements:|Saved-version IDs are project-scoped/);
assert.match(script, /navigator\.clipboard/);
assert.match(script, /OPEN " \+ stage\.label \+ " ↗"/);
assert.doesNotMatch(script, /stage\.latest|key: "latest"/);
assert.match(script, /open\.href = stage\.url/);
assert.match(script, /open\.target = "_blank"/);
assert.match(script, /open\.rel = "noopener noreferrer"/);
assert.match(script, /"Open " \+ stage\.label \+ " environment"/);
assert.match(script, /connecting\.disabled = true/);
assert.match(script, /connecting\.textContent = "CONNECTING…"/);
assert.doesNotMatch(script, /PREPARE DEPLOY LATEST/);
assert.match(script, /loading: true/);
assert.match(script, /health: null/);
assert.doesNotMatch(script, /cachedSnapshot|registrySnapshot|preserveSnapshot/);

const forbiddenAutomaticPromotion = await workerModule.default.fetch(
  new Request("https://control.test/api/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "development", to: "production" }),
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

function ownerRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: {
      "oai-authenticated-user-email": "owner@example.com",
      ...options.headers,
    },
  });
}

const configuredEnv = {
  CONTROL_OWNER_EMAIL: "owner@example.com",
  PROD_URL: "https://chessriot.gg",
  DEV_URL: "https://dev.chessriot.gg",
  PROD_OPS_READ_SECRET: "prod-secret-with-at-least-32-characters",
  DEV_OPS_READ_SECRET: "dev-secret-with-at-least-32-characters",
};
const unauthorizedStatus = await workerModule.default.fetch(
  new Request("https://control.test/api/status"),
  configuredEnv,
  {},
);
assert.equal(unauthorizedStatus.status, 403);

const statusResponse = await workerModule.default.fetch(
  ownerRequest("https://control.test/api/status"),
  configuredEnv,
  {},
);
const status = await statusResponse.json();
assert.equal(status.controlVersion, packageVersion);
assert.equal(status.refreshIntervalMs, 300000);
assert.deepEqual(
  status.environments.map(({ key, url, access, grant }) => ({
    key,
    url,
    access,
    hasGrant: typeof grant === "string" && grant.includes("."),
  })),
  [
    {
      key: "development",
      url: "https://dev.chessriot.gg",
      access: "Owner only",
      hasGrant: true,
    },
    {
      key: "production",
      url: "https://chessriot.gg",
      access: "Public",
      hasGrant: true,
    },
  ],
);
for (const environment of status.environments) {
  assert.equal("deployedVersion" in environment, false);
  assert.equal("lastKnownHealth" in environment, false);
  assert.equal("verifiedAt" in environment, false);
}
assert.equal("releases" in status, false);
assert.equal("latestVersion" in status, false);

const database = new FakeD1();
const persistentEnv = {
  ...configuredEnv,
  DB: database,
};
const seededResponse = await workerModule.default.fetch(
  ownerRequest("https://control.test/api/status"),
  persistentEnv,
  {},
);
const seeded = await seededResponse.json();
assert.equal(seeded.registryPersistence, "d1");
assert.equal("deployedVersion" in seeded.environments[0], false);
assert.equal(database.rows.get("development").deployed_version, "0.0.0");

const forgedObservationResponse = await workerModule.default.fetch(
  new Request("https://control.test/api/registry/observation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-control-observation": "browser-health-v1",
    },
    body: JSON.stringify({
      environment: "production",
      healthState: "fresh",
      runtimeVersion: "9.9.9",
    }),
  }),
  persistentEnv,
  {},
);
assert.equal(forgedObservationResponse.status, 403);
assert.equal(database.rows.get("production").deployed_version, "0.0.0");

const successfulObservationResponse = await workerModule.default.fetch(
  ownerRequest("https://control.test/api/registry/observation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://control.test",
      "sec-fetch-site": "same-origin",
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
  ownerRequest("https://control.test/api/registry/observation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://control.test",
      "sec-fetch-site": "same-origin",
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
  ownerRequest("https://control.test/api/status"),
  persistentEnv,
  {},
);
const persisted = await persistedResponse.json();
assert.equal("deployedVersion" in persisted.environments[0], false);
assert.equal(
  database.rows.get("development").last_health_at,
  successfulObservation.lastHealthAt,
);
assert.equal("latestVersion" in persisted, false);

console.log("Artifact is valid ESM and exports default.fetch");
