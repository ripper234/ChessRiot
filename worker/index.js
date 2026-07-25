const ENVIRONMENTS = [
  {
    key: "development",
    name: "Development",
    deployedVersionKey: "DEV_DEPLOYED_VERSION",
    urlKey: "DEV_URL",
    secretKey: "DEV_OPS_READ_SECRET",
    access: "Public",
    accent: "purple",
  },
  {
    key: "staging",
    name: "Staging",
    deployedVersionKey: "STAGING_DEPLOYED_VERSION",
    urlKey: "STAGING_URL",
    secretKey: "STAGING_OPS_READ_SECRET",
    access: "Owner only",
    accent: "cyan",
  },
  {
    key: "production",
    name: "Production",
    deployedVersionKey: "PROD_DEPLOYED_VERSION",
    urlKey: "PROD_URL",
    secretKey: "PROD_OPS_READ_SECRET",
    access: "Public",
    accent: "gold",
  },
];

const CONTROL_VERSION = "0.3.1";
const STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const HEALTH_STATES = new Set([
  "fresh",
  "degraded",
  "auth",
  "invalid",
  "misconfigured",
  "network",
  "not_configured",
  "server",
  "timeout",
  "unknown",
]);
const REGISTRY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS deployment_registry (
    environment TEXT PRIMARY KEY NOT NULL,
    deployed_version TEXT NOT NULL,
    deployed_at TEXT,
    verified_at TEXT,
    runtime_version TEXT,
    health_state TEXT NOT NULL DEFAULT 'unknown',
    health_status TEXT,
    database_status TEXT,
    last_health_at TEXT,
    last_checked_at TEXT,
    updated_at TEXT NOT NULL
  )
`;
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintGrant(secret, audience) {
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    aud: audience,
    scope: "observability:read",
    iat: now,
    exp: now + 120,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = base64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return encodedPayload + "." + base64Url(new Uint8Array(signature));
}

function bootstrapRegistry(env) {
  const fallback = Object.fromEntries(
    ENVIRONMENTS.map((config) => [
      config.key,
      {
        version: "0.0.0",
        deployedAt: null,
        verifiedAt: null,
        runtimeVersion: null,
        healthState: "unknown",
        healthStatus: null,
        databaseStatus: null,
        lastHealthAt: null,
        lastCheckedAt: null,
      },
    ]),
  );
  if (env.DEPLOYMENT_STATE_JSON) {
    try {
      const parsed = JSON.parse(env.DEPLOYMENT_STATE_JSON);
      for (const config of ENVIRONMENTS) {
        const candidate = parsed?.environments?.[config.key];
        if (!candidate || !SEMVER_PATTERN.test(candidate.version)) continue;
        fallback[config.key] = {
          ...fallback[config.key],
          version: candidate.version,
          deployedAt: typeof candidate.deployedAt === "string" ? candidate.deployedAt : null,
          verifiedAt: typeof candidate.verifiedAt === "string" ? candidate.verifiedAt : null,
        };
      }
    } catch {
      // Individual version variables and safe fallbacks remain authoritative.
    }
  }
  for (const config of ENVIRONMENTS) {
    const configuredVersion = env[config.deployedVersionKey];
    if (SEMVER_PATTERN.test(configuredVersion || "")) {
      if (fallback[config.key].version !== configuredVersion) {
        fallback[config.key].deployedAt = null;
        fallback[config.key].verifiedAt = null;
      }
      fallback[config.key].version = configuredVersion;
    }
  }
  return fallback;
}

function registryValue(row, fallback) {
  if (!row || !SEMVER_PATTERN.test(row.deployed_version || "")) return fallback;
  return {
    version: row.deployed_version,
    deployedAt: row.deployed_at || null,
    verifiedAt: row.verified_at || null,
    runtimeVersion: SEMVER_PATTERN.test(row.runtime_version || "")
      ? row.runtime_version
      : null,
    healthState: HEALTH_STATES.has(row.health_state) ? row.health_state : "unknown",
    healthStatus: row.health_status || null,
    databaseStatus: row.database_status || null,
    lastHealthAt: row.last_health_at || null,
    lastCheckedAt: row.last_checked_at || null,
  };
}

async function ensureDeploymentRegistry(env, fallback) {
  if (!env.DB || typeof env.DB.prepare !== "function") return false;
  await env.DB.prepare(REGISTRY_SCHEMA_SQL).run();
  const now = new Date().toISOString();
  const inserts = ENVIRONMENTS.map((config) =>
    env.DB.prepare(`
      INSERT INTO deployment_registry (
        environment,
        deployed_version,
        deployed_at,
        verified_at,
        health_state,
        updated_at
      ) VALUES (?, ?, ?, ?, 'unknown', ?)
      ON CONFLICT(environment) DO UPDATE SET
        deployed_version = excluded.deployed_version,
        deployed_at = COALESCE(excluded.deployed_at, deployment_registry.deployed_at),
        verified_at = excluded.verified_at,
        runtime_version = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN NULL
          ELSE deployment_registry.runtime_version
        END,
        health_state = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN 'unknown'
          ELSE deployment_registry.health_state
        END,
        health_status = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN NULL
          ELSE deployment_registry.health_status
        END,
        database_status = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN NULL
          ELSE deployment_registry.database_status
        END,
        last_health_at = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN NULL
          ELSE deployment_registry.last_health_at
        END,
        last_checked_at = CASE
          WHEN deployment_registry.deployed_version <> excluded.deployed_version THEN NULL
          ELSE deployment_registry.last_checked_at
        END,
        updated_at = excluded.updated_at
      WHERE excluded.verified_at IS NOT NULL
        AND (
          deployment_registry.verified_at IS NULL
          OR excluded.verified_at > deployment_registry.verified_at
        )
    `).bind(
      config.key,
      fallback[config.key].version,
      fallback[config.key].deployedAt,
      fallback[config.key].verifiedAt,
      now,
    ),
  );
  if (typeof env.DB.batch === "function") await env.DB.batch(inserts);
  else for (const statement of inserts) await statement.run();
  return true;
}

async function deploymentRegistry(env) {
  const fallback = bootstrapRegistry(env);
  try {
    if (!await ensureDeploymentRegistry(env, fallback)) {
      return { environments: fallback, persistence: "fallback" };
    }
    const response = await env.DB.prepare(`
      SELECT
        environment,
        deployed_version,
        deployed_at,
        verified_at,
        runtime_version,
        health_state,
        health_status,
        database_status,
        last_health_at,
        last_checked_at
      FROM deployment_registry
    `).all();
    for (const row of response.results || []) {
      if (!fallback[row.environment]) continue;
      fallback[row.environment] = registryValue(row, fallback[row.environment]);
    }
    return { environments: fallback, persistence: "d1" };
  } catch {
    return { environments: fallback, persistence: "fallback" };
  }
}

function registryJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readObservationBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4096) throw new Error("body_too_large");
  const text = await request.text();
  if (text.length > 4096) throw new Error("body_too_large");
  return JSON.parse(text);
}

async function observationResponse(request, env) {
  if (request.headers.get("x-control-observation") !== "browser-health-v1") {
    return registryJson({ error: "not_authorized" }, 403);
  }
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return registryJson({ error: "persistence_unavailable" }, 503);
  }
  let body;
  try {
    body = await readObservationBody(request);
  } catch {
    return registryJson({ error: "invalid_json" }, 400);
  }
  const config = ENVIRONMENTS.find((entry) => entry.key === body?.environment);
  const state = typeof body?.healthState === "string" ? body.healthState : "unknown";
  const runtimeVersion = SEMVER_PATTERN.test(body?.runtimeVersion || "")
    ? body.runtimeVersion
    : null;
  if (!config || !HEALTH_STATES.has(state)) {
    return registryJson({ error: "invalid_observation" }, 400);
  }
  const confirmsDeployment =
    (state === "fresh" || state === "degraded") && runtimeVersion !== null;
  if ((state === "fresh" || state === "degraded") && !runtimeVersion) {
    return registryJson({ error: "invalid_runtime_version" }, 400);
  }
  const fallback = bootstrapRegistry(env);
  await ensureDeploymentRegistry(env, fallback);
  const current = await env.DB.prepare(`
    SELECT
      deployed_version,
      deployed_at,
      verified_at,
      runtime_version,
      last_health_at
    FROM deployment_registry
    WHERE environment = ?
  `).bind(config.key).first();
  if (!current) return registryJson({ error: "registry_missing" }, 500);

  const now = new Date().toISOString();
  const deployedVersion = confirmsDeployment
    ? runtimeVersion
    : current.deployed_version;
  const deployedAt = confirmsDeployment && runtimeVersion !== current.deployed_version
    ? now
    : current.deployed_at;
  const verifiedAt = confirmsDeployment ? now : current.verified_at;
  const healthStatus = typeof body?.healthStatus === "string"
    ? body.healthStatus.slice(0, 32)
    : null;
  const databaseStatus = typeof body?.databaseStatus === "string"
    ? body.databaseStatus.slice(0, 32)
    : null;
  const lastHealthAt = confirmsDeployment ? now : current.last_health_at;

  await env.DB.prepare(`
    UPDATE deployment_registry
    SET
      deployed_version = ?,
      deployed_at = ?,
      verified_at = ?,
      runtime_version = ?,
      health_state = ?,
      health_status = ?,
      database_status = ?,
      last_health_at = ?,
      last_checked_at = ?,
      updated_at = ?
    WHERE environment = ?
  `).bind(
    deployedVersion,
    deployedAt,
    verifiedAt,
    runtimeVersion || current.runtime_version,
    state,
    healthStatus,
    databaseStatus,
    lastHealthAt,
    now,
    now,
    config.key,
  ).run();

  return registryJson({
    environment: config.key,
    deployedVersion,
    deployedAt,
    verifiedAt,
    runtimeVersion: runtimeVersion || current.runtime_version || null,
    healthState: state,
    healthStatus,
    databaseStatus,
    lastHealthAt,
    lastCheckedAt: now,
  });
}

async function statusResponse(env) {
  const registry = await deploymentRegistry(env);
  const environments = await Promise.all(
    ENVIRONMENTS.map(async (config) => ({
      key: config.key,
      name: config.name,
      access: config.access,
      accent: config.accent,
      url: env[config.urlKey] ?? null,
      grant: await mintGrant(env[config.secretKey], config.key),
    })),
  );
  return Response.json(
    {
      environments,
      controlVersion: CONTROL_VERSION,
      registryPersistence: registry.persistence,
      refreshIntervalMs: STATUS_REFRESH_INTERVAL_MS,
      sourceUrl: "https://github.com/ripper234/ChessRiot",
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ChessRiot Control</title>
    <style>
      :root {
        color-scheme: dark;
        --navy:#0b1020;--black:#050914;--surface:#10192b;--raised:#17233a;
        --line:#2a3958;--text:#f7f9ff;--muted:#91a0b8;--cyan:#00e5ff;
        --gold:#ffc400;--purple:#9a6cff;--pink:#ff2e6e;--green:#17e0c2;
        --display:Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif;
        --ui:Inter,ui-sans-serif,system-ui,sans-serif;
        --mono:"SFMono-Regular",Consolas,monospace;
      }
      *{box-sizing:border-box} body{min-width:320px;min-height:100vh;margin:0;color:var(--text);
        font-family:var(--ui);background:radial-gradient(circle at 12% 0,rgba(0,229,255,.07),transparent 28rem),var(--navy)}
      a{color:inherit}button,select{font:inherit}.topbar{min-height:62px;display:flex;align-items:center;
        justify-content:space-between;gap:18px;padding:10px clamp(16px,4vw,52px);
        border-bottom:1px solid var(--line);background:rgba(5,9,20,.92)}
      .brand{display:flex;align-items:center;gap:10px}.mark{width:36px;height:36px;display:grid;place-items:center;
        color:var(--black);background:var(--gold);font:23px/1 Georgia,serif;
        clip-path:polygon(50% 0,100% 25%,85% 78%,50% 100%,15% 78%,0 25%)}
      .brand strong{display:block;font:italic 24px/.9 var(--display);text-transform:uppercase}
      .header-links{display:flex;align-items:center;gap:8px}
      .github{min-height:36px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #43516a;
        border-radius:999px;background:#101625;font:800 10px/1 var(--mono);text-decoration:none}.github svg{width:18px;fill:#fff}
      main{width:min(1180px,100%);margin:0 auto;padding:24px clamp(14px,3vw,34px) 54px}
      .release-board{padding:clamp(17px,3vw,28px);border:1px solid #33425f;
        background:linear-gradient(145deg,rgba(17,26,45,.98),rgba(7,12,24,.98))}
      .hero{display:flex;align-items:start;justify-content:space-between;gap:24px;margin-bottom:22px}.eyebrow{
        margin:0 0 8px;color:var(--cyan);font:800 9px/1 var(--mono);letter-spacing:1.3px}
      h1{margin:0;font:italic clamp(34px,5vw,52px)/.9 var(--display);text-transform:uppercase}
      .subtitle{max-width:610px;margin:10px 0 0;color:#bdc9dc;font-size:13px;line-height:1.45}
      .auto{max-width:310px;padding:10px 12px;border-left:2px solid var(--green);background:rgba(23,224,194,.05)}
      .cadence{display:flex;align-items:center;gap:7px;color:var(--green);font:800 9px/1 var(--mono)}.pulse{
        width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green)}
      .checked{margin:7px 0 0;color:#aebbd0;font:700 9px/1.4 var(--mono)}
      .pipeline{display:grid;grid-template-columns:minmax(120px,1fr) 92px minmax(120px,1fr) 116px minmax(120px,1fr) 116px minmax(120px,1fr);
        align-items:stretch;gap:8px}.pipeline-node{min-width:0;display:flex;flex-direction:column;align-items:flex-start;
        padding:14px;border:1px solid var(--line);background:rgba(5,9,20,.6)}.pipeline-node.latest{border-color:rgba(255,196,0,.55)}
      .pipeline-label{display:block;color:var(--muted);font:800 8px/1 var(--mono);letter-spacing:.8px}
      .pipeline-node b{display:block;margin:7px 0 12px;overflow:hidden;color:var(--text);font:italic 24px/1 var(--display);
        text-overflow:ellipsis;white-space:nowrap}.pipeline-open{min-height:31px;display:inline-flex;align-items:center;
        justify-content:center;margin-top:auto;padding:0 9px;border:1px solid rgba(0,229,255,.55);color:var(--cyan);
        background:rgba(0,229,255,.06);font:850 10px/1 var(--mono);letter-spacing:.5px;text-decoration:none;
        cursor:pointer}.pipeline-open:hover{border-color:var(--cyan);background:rgba(0,229,255,.13)}
      .pipeline-open:disabled{border-color:#35425d;color:#718099;background:transparent;cursor:wait}
      .pipeline-connector{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
        color:var(--muted);text-align:center}.pipeline-arrow{color:var(--cyan);font:900 16px/1 var(--mono)}
      .pipeline-action{width:100%;min-height:34px;padding:4px 6px;border:1px solid #44516a;color:var(--muted);
        background:#1a2438;font:850 8px/1.2 var(--mono)}.pipeline-action.sync{border-color:rgba(23,224,194,.4);color:var(--green);
        background:rgba(23,224,194,.04)}.pipeline-action.auto{border-color:rgba(154,108,255,.45);color:#c8b6ff;
        background:rgba(154,108,255,.06)}.pipeline-blocker{font:700 7px/1.35 var(--mono);text-transform:uppercase}
      .authority-note{display:flex;align-items:flex-start;gap:9px;margin:14px 0 0;padding:10px 12px;border:1px solid rgba(255,196,0,.22);
        color:#b8c4d7;background:rgba(255,196,0,.035);font:650 10px/1.45 var(--mono)}.authority-note b{color:var(--gold)}
      .drawer{margin-top:14px;border:1px solid var(--line);background:rgba(5,9,20,.48)}.drawer>summary{display:flex;
        align-items:center;justify-content:flex-start;gap:14px;padding:15px 17px;color:var(--text);cursor:pointer;
        list-style:none;font:italic 22px/1 var(--display);text-transform:uppercase}.drawer>summary::-webkit-details-marker{display:none}
      .drawer>summary:after{content:"+";margin-left:auto;color:var(--cyan);font:700 22px/1 var(--ui)}.drawer[open]>summary:after{content:"−"}
      .summary-title{display:inline-flex;align-items:baseline;gap:7px}
      .drawer-count{margin-left:7px;color:var(--cyan);font:750 10px/1 var(--mono);letter-spacing:.3px}.drawer-body{padding:0 17px 17px}
      .grid{display:grid;gap:9px}.card{position:relative;padding:15px;border:1px solid #293854;background:rgba(17,26,45,.72)}
      .card[data-accent=gold]{--accent:var(--gold)}.card[data-accent=cyan]{--accent:var(--cyan)}
      .card[data-accent=purple]{--accent:var(--purple)}.card-head{display:flex;align-items:start;justify-content:space-between;gap:12px}
      .card h2{margin:0 0 4px;font:italic 23px/1 var(--display);text-transform:uppercase}.access{color:var(--muted);
        font:700 9px/1.25 var(--mono)}.status{display:flex;align-items:center;gap:7px;font:800 8px/1 var(--mono)}
      .lamp{width:9px;height:9px;
        border:1px solid #4a5670;background:#29344a;transform:rotate(45deg)}.ok{color:var(--green)}.ok .lamp{
        border-color:var(--green);background:var(--green);box-shadow:0 0 12px var(--green)}.warn{color:var(--gold)}
      .warn .lamp{border-color:var(--gold);background:var(--gold)}.down{color:#ff8cab}.environment-summary{
        display:grid;grid-template-columns:120px minmax(220px,1fr) minmax(360px,1.6fr);align-items:center;gap:15px;margin-top:13px}
      .version-label{margin:0 0 4px;color:var(--muted);font:700 8px/1 var(--mono);letter-spacing:.8px}
      .version{margin:0;color:var(--accent);font:italic 31px/1 var(--display)}.expected{margin:0;color:#b7c3d8;font-size:10px;line-height:1.45}
      .metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.metric{padding:8px 6px;
        border:1px solid #2c3a57;background:rgba(5,9,20,.45)}.metric b{display:block;color:var(--text);
        font:italic 17px/1 var(--display)}.metric span{display:block;margin-top:4px;color:var(--muted);
        font:700 7px/1.2 var(--mono);text-transform:uppercase}.metric.error b{color:#ff8cab}
      .telemetry-note{margin:9px 0 0;color:#9eacc2;font:650 9px/1.4 var(--mono)}
      .card-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:11px}.open{
        display:inline-flex;align-items:center;min-height:32px;padding:0 10px;border:1px solid rgba(0,229,255,.42);
        color:var(--cyan);font:800 9px/1 var(--mono);text-decoration:none}.advanced-details{margin:0}.advanced-details summary{
        color:var(--muted);cursor:pointer;font:750 9px/1.4 var(--mono)}.advanced{margin-top:10px}.release-label{
        display:block;margin:0 0 6px;color:var(--muted);font:750 9px/1 var(--mono)}.actions{
        display:grid;grid-template-columns:1fr auto;gap:7px}select,.prepare{min-height:36px;border:1px solid #3a4862;
        color:var(--muted);background:var(--black)}select{min-width:0;padding:0 9px}.prepare{padding:0 11px;color:#718099;
        cursor:not-allowed;font:800 8px/1 var(--mono)}.events-head{display:flex;align-items:center;justify-content:flex-end;
        gap:15px;margin-bottom:12px}.tabs{display:flex;flex-wrap:wrap;gap:7px}.tab{min-height:32px;
        padding:0 11px;border:1px solid #41506c;color:#c8d3e6;background:transparent;cursor:pointer;font:800 9px/1 var(--mono)}
      .tab[aria-selected=true]{border-color:var(--cyan);color:var(--cyan);background:rgba(0,229,255,.08)}
      .event-table{width:100%;border-collapse:collapse;font:650 10px/1.35 var(--mono)}th,td{padding:9px 8px;
        border-bottom:1px solid #25334e;text-align:left;vertical-align:top}th{color:var(--muted);font-size:8px;letter-spacing:.8px}
      td.success{color:var(--green)}td.rejected{color:var(--gold)}td.failure{color:#ff8cab}.empty{padding:25px;
        color:var(--muted);text-align:center;font:700 11px/1.4 var(--mono)}
      .feedback-head{display:flex;align-items:center;justify-content:flex-end;gap:15px;
        margin-bottom:12px}
      .feedback-count{color:var(--cyan);font:800 9px/1 var(--mono)}.feedback-list{display:grid;gap:8px}
      .feedback-item{padding:13px;border:1px solid #2b3956;background:rgba(17,26,45,.72)}
      .feedback-item strong{display:block;font-size:12px}.feedback-item p{margin:7px 0 0;color:#c0cbde;font-size:11px;
        line-height:1.5;white-space:pre-wrap}.feedback-meta{display:block;margin-top:9px;color:var(--muted);
        font:700 8px/1.35 var(--mono)}
      button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
      @media(max-width:980px){.pipeline{grid-template-columns:1fr}.pipeline-connector{min-height:62px}.pipeline-arrow{transform:rotate(90deg)}
        .pipeline-action{width:min(260px,100%)}.environment-summary{grid-template-columns:100px 1fr}.metrics{grid-column:1/-1}}
      @media(max-width:680px){.topbar{padding:10px 13px}.brand strong{font-size:21px}.brand small{display:none}
        .github{width:38px;padding:0;justify-content:center}.github span{display:none}.github.releases-link{width:auto;padding:0 10px}main{padding:14px 10px 40px}.release-board{padding:14px}
        .hero{flex-direction:column}.auto{max-width:none;width:100%}.drawer>summary{font-size:19px}.environment-summary{grid-template-columns:1fr}
        .metrics{grid-template-columns:repeat(2,1fr)}.card-tools{align-items:flex-start;flex-direction:column}.actions{grid-template-columns:1fr}
        .drawer-body{padding:0 11px 11px;overflow:auto}.events-head{align-items:start;flex-direction:column}
        .event-table{min-width:680px}.release{grid-template-columns:66px 1fr}.release a{grid-column:2}}
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand"><span class="mark">♞</span><strong>ChessRiot Control</strong></div>
      <nav class="header-links" aria-label="Project links">
        <a class="github releases-link" href="https://chessriot.ripper234.chatgpt.site/releases" target="_blank" rel="noopener noreferrer">Releases</a>
        <a class="github github-source" href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer" aria-label="View ChessRiot source on GitHub">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.98 10.98 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
          <span>GitHub</span>
        </a>
      </nav>
    </header>
    <main>
      <section class="release-board">
        <div class="hero">
          <div><p class="eyebrow">CONTROL v${CONTROL_VERSION}</p>
            <h1>Release pipeline</h1>
          </div>
          <div class="auto"><span class="cadence"><i class="pulse"></i>AUTO CHECK · 5 MIN</span>
            <p class="checked" id="checked">Checking environments…</p></div>
        </div>
        <section class="pipeline" id="pipeline" aria-label="Release pipeline"></section>
        <p class="authority-note"><span aria-hidden="true">⚿</span><span><b>Promotions require Sites access.</b></span></p>
      </section>
      <details class="drawer">
        <summary>Environment health</summary>
        <div class="drawer-body"><section class="grid" id="grid" aria-live="polite" aria-busy="true"></section></div>
      </details>
      <details class="drawer">
        <summary>Recent events</summary>
        <div class="drawer-body">
          <div class="events-head"><div class="tabs" id="tabs"></div></div>
          <div id="event-content"><p class="empty">Loading environment events…</p></div>
        </div>
      </details>
      <details class="drawer feedback" id="feedback">
        <summary><span class="summary-title">Feedback <span class="drawer-count" id="feedback-count">— · PRODUCTION</span></span></summary>
        <div class="drawer-body"><div class="feedback-head"></div><div id="feedback-content"></div></div>
      </details>
    </main>
    <script src="/control.js" defer></script>
  </body>
</html>`;

const clientScript = String.raw`
  const grid = document.querySelector("#grid");
  const pipeline = document.querySelector("#pipeline");
  const checked = document.querySelector("#checked");
  const tabs = document.querySelector("#tabs");
  const eventContent = document.querySelector("#event-content");
  const feedbackCount = document.querySelector("#feedback-count");
  const feedbackContent = document.querySelector("#feedback-content");
  const initialEnvironments = ${JSON.stringify(
    ENVIRONMENTS.map(
      ({ key, name, access, accent }) => ({
        key,
        name,
        access,
        accent,
      }),
    ),
  )};
  const snapshots = new Map();
  let activeEnvironment = "production";
  let lastAttemptAt = null;
  let lastCompletedAt = null;
  let lastSuccessfulAt = null;
  let refreshIntervalMs = 300000;
  let statusRequest = null;
  const requestTimeoutMs = 15000;

  async function readJson(response, allowHttpError) {
    let data;
    try {
      data = await response.json();
    } catch {
      const invalid = new Error("Invalid JSON response");
      invalid.status = response.status;
      throw invalid;
    }
    if (!response.ok && !allowHttpError) {
      const failure = new Error("HTTP " + response.status);
      failure.status = response.status;
      failure.data = data;
      throw failure;
    }
    return allowHttpError ? { data: data, status: response.status, ok: response.ok } : data;
  }

  async function fetchProbe(url, options) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, requestTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return readJson(response, true);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function persistObservation(snapshot) {
    const runtimeVersion = snapshot.healthFresh && snapshot.health
      ? snapshot.health.version
      : null;
    try {
      const response = await fetch("/api/registry/observation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-control-observation": "browser-health-v1",
        },
        body: JSON.stringify({
          environment: snapshot.item.key,
          healthState: snapshot.healthState,
          runtimeVersion: runtimeVersion,
          healthStatus: snapshot.healthFresh && snapshot.health
            ? snapshot.health.status
            : null,
          databaseStatus: snapshot.healthFresh && snapshot.health
            ? snapshot.health.database
            : null,
        }),
        cache: "no-store",
      });
      if (!response.ok) return;
      await response.body?.cancel();
    } catch {
      // The current check still renders; the next five-minute cycle retries persistence.
    }
  }

  function probeState(result, expectedEnvironment) {
    if (result.status === "rejected") {
      const reason = result.reason;
      return {
        fresh: false,
        state: reason && reason.name === "AbortError" ? "timeout" : "network",
        data: null,
      };
    }
    const response = result.value;
    if (response.status === 401 || response.status === 403) {
      return { fresh: false, state: "auth", data: null };
    }
    if (!response.data || typeof response.data !== "object") {
      return { fresh: false, state: "invalid", data: null };
    }
    if (response.data.environment !== expectedEnvironment) {
      return { fresh: false, state: "misconfigured", data: response.data };
    }
    if (response.status >= 500 && response.data.status !== "degraded") {
      return { fresh: false, state: "server", data: null };
    }
    return {
      fresh: true,
      state: response.data.status === "degraded" ? "degraded" : "fresh",
      data: response.data,
    };
  }

  async function inspectEnvironment(item) {
    if (!item.url) {
      const value = {
        item: item,
        health: null,
        overview: null,
        healthFresh: false,
        telemetryFresh: false,
        healthState: "not_configured",
        telemetryState: "not_configured",
        checkedAt: new Date(),
        lastHealthAt: null,
        lastTelemetryAt: null,
      };
      snapshots.set(item.key, value);
      await persistObservation(value);
      return value;
    }
    const healthPromise = fetchProbe(item.url + "/api/health?control-check=" + Date.now(), {
      cache: "no-store",
      credentials: item.access === "Owner only" ? "include" : "omit",
    });
    const overviewPromise = item.grant
      ? fetchProbe(item.url + "/api/ops/overview", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: item.grant,
          cache: "no-store",
          credentials: item.access === "Owner only" ? "include" : "omit",
        })
      : Promise.reject(new Error("Telemetry grant missing"));
    const results = await Promise.allSettled([healthPromise, overviewPromise]);
    const healthProbe = probeState(results[0], item.key);
    const telemetryProbe = probeState(results[1], item.key);
    const now = new Date();
    const health = healthProbe.fresh ? healthProbe.data : null;
    const overview = telemetryProbe.fresh ? telemetryProbe.data : null;
    const value = {
      item,
      health: health || null,
      overview: overview || null,
      healthFresh: healthProbe.fresh,
      telemetryFresh: telemetryProbe.fresh,
      healthState: healthProbe.state,
      telemetryState: telemetryProbe.state,
      checkedAt: now,
      lastHealthAt: healthProbe.fresh ? now : null,
      lastTelemetryAt: telemetryProbe.fresh ? now : null,
    };
    snapshots.set(item.key, value);
    await persistObservation(value);
    return value;
  }

  function failedInspection(item) {
    const value = {
      item: item,
      health: null,
      overview: null,
      healthFresh: false,
      telemetryFresh: false,
      healthState: "network",
      telemetryState: "network",
      checkedAt: new Date(),
      lastHealthAt: null,
      lastTelemetryAt: null,
    };
    snapshots.set(item.key, value);
    return value;
  }

  function metric(label, value, error) {
    const element = document.createElement("div");
    element.className = "metric" + (error ? " error" : "");
    const strong = document.createElement("b");
    strong.textContent = value === null || value === undefined ? "—" : String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    element.append(strong, caption);
    return element;
  }

  function breakdownCount(overview, event, outcome) {
    const row = overview && overview.breakdown && overview.breakdown.find(function (entry) {
      return entry.event_name === event && entry.outcome === outcome;
    });
    return row ? row.count : 0;
  }

  function verifiedVersion(snapshot) {
    if (
      snapshot
      && snapshot.healthFresh
      && snapshot.health
      && /^\d+\.\d+\.\d+$/.test(snapshot.health.version || "")
    ) return snapshot.health.version;
    return null;
  }

  function createCard(snapshot) {
    const item = snapshot.item;
    const health = snapshot.health;
    const overview = snapshot.telemetryFresh ? snapshot.overview : null;
    const loading = Boolean(snapshot.loading);
    const runtimeVersion = verifiedVersion(snapshot);
    const healthy = snapshot.healthFresh && health && health.status === "ok";
    const article = document.createElement("article");
    article.className = "card";
    article.dataset.accent = item.accent;
    article.innerHTML =
      '<div class="card-head"><div><h2></h2><span class="access"></span></div>' +
      '<span class="status"><span class="lamp"></span><span class="status-text"></span></span></div>' +
      '<div class="environment-summary"><div><p class="version-label">LIVE VERSION</p><p class="version"></p></div>' +
      '<p class="expected"></p><div class="metrics"></div></div><p class="telemetry-note"></p>' +
      '<div class="card-tools"><a class="open" target="_blank" rel="noopener noreferrer">OPEN ENVIRONMENT ↗</a></div>';
    article.querySelector("h2").textContent = item.name;
    article.querySelector(".access").textContent = item.access + " // isolated data";
    article.querySelector(".version").textContent = runtimeVersion
      ? "v" + runtimeVersion
      : "—";
    const status = article.querySelector(".status");
    const statusText = article.querySelector(".status-text");
    if (loading) {
      status.classList.add("warn");
      statusText.textContent = "CHECKING HEALTH";
    } else if (snapshot.healthState === "auth") {
      status.classList.add("warn");
      statusText.textContent = "AUTH REQUIRED";
    } else if (snapshot.healthState === "misconfigured") {
      status.classList.add("down");
      statusText.textContent = "MISCONFIGURED";
    } else if (!snapshot.healthFresh) {
      status.classList.add("warn");
      statusText.textContent = snapshot.healthState === "timeout"
        ? "CHECK TIMED OUT"
        : "COULD NOT VERIFY";
    } else if (!healthy) {
      status.classList.add("warn");
      statusText.textContent = "DEGRADED";
    } else {
      status.classList.add("ok");
      statusText.textContent = "HEALTHY";
    }
    const expected = article.querySelector(".expected");
    expected.textContent = loading
      ? "Checking live runtime…"
      : runtimeVersion
        ? "Verified by this page check"
        : "Could not verify a current version";

    const metrics = article.querySelector(".metrics");
    const totals = overview && overview.totals;
    const games = overview && overview.games;
    const errorRate = totals && totals.total
      ? Math.round(totals.failures / totals.total * 1000) / 10 + "%"
      : totals ? "0%" : null;
    metrics.append(
      metric("Games created · 24h", overview ? breakdownCount(overview, "game.created", "success") : null),
      metric("Moves · 24h", overview ? breakdownCount(overview, "move.submitted", "success") : null),
      metric("Active games", games && games.active),
      metric("Failures · 24h", totals && totals.failures, Boolean(totals && totals.failures)),
      metric("Error rate", errorRate, Boolean(totals && totals.failures)),
      metric("p95 latency", totals && totals.p95LatencyMs !== null ? totals.p95LatencyMs + "ms" : null),
    );
    const note = article.querySelector(".telemetry-note");
    if (loading) note.textContent = "Loading health and telemetry…";
    else if (!overview && snapshot.telemetryState === "auth") {
      note.textContent = "Telemetry authorization required. Deployment state is unaffected.";
    } else if (!overview) note.textContent = "Could not verify telemetry. No zeroes or demo data substituted.";
    else note.textContent = "Last event " + (totals.lastEventAt ? new Date(totals.lastEventAt).toLocaleString() : "none yet");
    const link = article.querySelector(".open");
    if (item.url) link.href = item.url;
    else {
      link.removeAttribute("href");
      link.textContent = "CONNECTING…";
    }
    article.addEventListener("click", function (event) {
      if (event.target.closest("button,select,a")) return;
      activeEnvironment = item.key;
      renderEvents();
    });
    return article;
  }

  function renderPipeline() {
    const developmentVersion = verifiedVersion(snapshots.get("development"));
    const stages = [
      { key: "latest", label: "LATEST IN DEV", version: developmentVersion, latest: true },
      {
        key: "development",
        label: "DEVELOPMENT",
        version: verifiedVersion(snapshots.get("development")),
        url: snapshots.get("development") && snapshots.get("development").item.url,
      },
      {
        key: "staging",
        label: "STAGING",
        version: verifiedVersion(snapshots.get("staging")),
        url: snapshots.get("staging") && snapshots.get("staging").item.url,
      },
      {
        key: "production",
        label: "PRODUCTION",
        version: verifiedVersion(snapshots.get("production")),
        url: snapshots.get("production") && snapshots.get("production").item.url,
      },
    ];
    pipeline.replaceChildren();
    stages.forEach(function (stage, index) {
      if (index) {
        const source = stages[index - 1];
        const connector = document.createElement("div");
        connector.className = "pipeline-connector";
        const arrow = document.createElement("span");
        arrow.className = "pipeline-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "→";
        const action = document.createElement("button");
        action.type = "button";
        action.disabled = true;
        action.className = "pipeline-action";
        const blocker = document.createElement("span");
        blocker.className = "pipeline-blocker";
        if (!source.version || !stage.version) {
          action.textContent = "CHECKING";
          blocker.textContent = "current data";
          action.setAttribute("aria-label", "Waiting for current version checks");
        } else if (stage.key === "development") {
          action.classList.add("auto");
          action.textContent = stage.version === source.version
            ? "DEV CURRENT"
            : "AUTO TARGET v" + source.version;
          blocker.textContent = "release workflow";
          action.setAttribute("aria-label", "Development follows the latest release workflow");
        } else if (stage.version && source.version === stage.version) {
          action.classList.add("sync");
          action.textContent = "IN SYNC";
          blocker.textContent = "same release";
          action.setAttribute("aria-label", source.label + " and " + stage.label + " are in sync");
        } else {
          action.textContent = source.version ? "PROMOTE v" + source.version : "PROMOTE";
          blocker.textContent = "deploy access required";
          action.title = "Control has no Sites deployment authority yet.";
          action.setAttribute("aria-label", "Promotion disabled until direct deployment access is connected");
        }
        connector.append(arrow, action, blocker);
        pipeline.append(connector);
      }
      const node = document.createElement("article");
      node.className = "pipeline-node" + (stage.latest ? " latest" : "");
      const label = document.createElement("span");
      label.className = "pipeline-label";
      label.textContent = stage.label;
      const version = document.createElement("b");
      version.textContent = stage.version ? "v" + stage.version : "—";
      node.append(label, version);
      if (!stage.latest) {
        if (stage.url) {
          const open = document.createElement("a");
          open.className = "pipeline-open";
          open.href = stage.url;
          open.target = "_blank";
          open.rel = "noopener noreferrer";
          open.setAttribute("aria-label", "Open " + stage.label + " environment");
          open.textContent = "OPEN " + stage.label + " ↗";
          node.append(open);
        } else {
          const connecting = document.createElement("button");
          connecting.className = "pipeline-open";
          connecting.type = "button";
          connecting.disabled = true;
          connecting.textContent = "CONNECTING…";
          connecting.setAttribute("aria-label", stage.label + " environment link is loading");
          node.append(connecting);
        }
      }
      pipeline.append(node);
    });
  }

  function renderTabs() {
    tabs.replaceChildren();
    for (const snapshot of snapshots.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab";
      button.textContent = snapshot.item.name;
      button.setAttribute("aria-selected", String(snapshot.item.key === activeEnvironment));
      button.addEventListener("click", function () {
        activeEnvironment = snapshot.item.key;
        renderTabs();
        renderEvents();
      });
      tabs.append(button);
    }
  }

  function feedbackData(overview) {
    if (!overview || typeof overview !== "object") return null;
    const candidate = overview.feedbackPool ?? overview.feedback;
    if (Array.isArray(candidate)) {
      return { items: candidate, total: candidate.length };
    }
    if (candidate && Array.isArray(candidate.items)) {
      return {
        items: candidate.items,
        total: Number.isFinite(candidate.total) ? candidate.total : candidate.items.length,
      };
    }
    return null;
  }

  function feedbackTimestamp(entry) {
    return entry && (
      entry.createdAt ||
      entry.submittedAt ||
      entry.occurredAt ||
      entry.created_at
    );
  }

  function renderFeedback() {
    const snapshot = snapshots.get(activeEnvironment);
    const feedback = feedbackData(snapshot && snapshot.overview);
    if (!feedback) {
      feedbackCount.textContent = "— · " +
        (snapshot && snapshot.item
          ? snapshot.item.name.toUpperCase()
          : "PRODUCTION");
      feedbackContent.innerHTML =
        '<p class="empty">Could not verify current feedback.</p>';
      return;
    }
    feedbackCount.textContent = feedback.total + (feedback.total === 1 ? " ITEM" : " ITEMS") +
      " · " + (snapshot && snapshot.item ? snapshot.item.name.toUpperCase() : "");
    if (!feedback.items.length) {
      feedbackContent.innerHTML = '<p class="empty">No feedback submitted yet.</p>';
      return;
    }
    const list = document.createElement("div");
    list.className = "feedback-list";
    const ordered = feedback.items.slice().sort(function (left, right) {
      return String(feedbackTimestamp(right) || "").localeCompare(
        String(feedbackTimestamp(left) || ""),
      );
    });
    ordered.forEach(function (entry) {
      const item = document.createElement("article");
      item.className = "feedback-item";
      const title = document.createElement("strong");
      title.textContent = entry && entry.title ? String(entry.title) : "Untitled feedback";
      item.append(title);
      const comment = entry && (entry.comment || entry.details || entry.message);
      if (comment) {
        const body = document.createElement("p");
        body.textContent = String(comment);
        item.append(body);
      }
      const meta = document.createElement("span");
      meta.className = "feedback-meta";
      const timestamp = feedbackTimestamp(entry);
      const status = entry && entry.status ? String(entry.status) : "new";
      meta.textContent = (timestamp ? new Date(timestamp).toLocaleString() + " · " : "") + status;
      item.append(meta);
      list.append(item);
    });
    feedbackContent.replaceChildren(list);
  }

  function renderEvents() {
    renderFeedback();
    const snapshot = snapshots.get(activeEnvironment);
    if (snapshot && snapshot.loading) {
      eventContent.innerHTML = '<p class="empty">Loading environment events…</p>';
      return;
    }
    const events = snapshot && snapshot.overview && snapshot.overview.recentEvents;
    if (!events) {
      eventContent.innerHTML = '<p class="empty">No readable telemetry for this environment.</p>';
      return;
    }
    if (!events.length) {
      eventContent.innerHTML = '<p class="empty">No events recorded yet.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "event-table";
    table.innerHTML = "<thead><tr><th>TIME</th><th>EVENT</th><th>RESULT</th><th>REQUEST</th><th>GAME REF</th><th>DETAIL</th></tr></thead>";
    const body = document.createElement("tbody");
    events.forEach(function (event) {
      const row = document.createElement("tr");
      const values = [
        new Date(event.occurredAt).toLocaleString(),
        event.event,
        event.outcome,
        event.requestId || "—",
        event.gameRef || "—",
        event.errorCode || (event.latencyMs === null ? "—" : event.latencyMs + "ms"),
      ];
      values.forEach(function (value, index) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 2) cell.className = event.outcome;
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    eventContent.replaceChildren(table);
  }

  async function loadStatus() {
    if (statusRequest) return statusRequest;
    grid.setAttribute("aria-busy", "true");
    statusRequest = (async function () {
      lastAttemptAt = new Date();
      for (const [key, snapshot] of snapshots) {
        snapshots.set(key, {
          item: snapshot.item,
          health: null,
          overview: null,
          healthFresh: false,
          telemetryFresh: false,
          healthState: "unknown",
          telemetryState: "unknown",
          loading: true,
        });
      }
      grid.replaceChildren(...[...snapshots.values()].map(createCard));
      renderPipeline();
      renderEvents();
      try {
        const status = await fetch("/api/status", { cache: "no-store" }).then(function (response) {
          return readJson(response, false);
        });
        refreshIntervalMs = status.refreshIntervalMs;
        status.environments.forEach(function (item) {
          snapshots.set(item.key, {
            item,
            health: null,
            overview: null,
            healthFresh: false,
            telemetryFresh: false,
            healthState: "unknown",
            telemetryState: "unknown",
            loading: true,
          });
        });
        grid.replaceChildren(...[...snapshots.values()].map(createCard));
        renderPipeline();
        renderTabs();
        renderEvents();
        const inspectionResults = await Promise.allSettled(
          status.environments.map(inspectEnvironment),
        );
        const inspected = inspectionResults.map(function (result, index) {
          return result.status === "fulfilled"
            ? result.value
            : failedInspection(status.environments[index]);
        });
        grid.replaceChildren(...inspected.map(createCard));
        renderPipeline();
        if (!snapshots.has(activeEnvironment) && inspected[0]) activeEnvironment = inspected[0].item.key;
        renderTabs();
        renderEvents();
        lastCompletedAt = new Date();
        const liveChecks = inspected.filter(function (entry) { return entry.healthFresh; }).length;
        const successfulTimes = inspected
          .map(function (entry) { return entry.lastHealthAt; })
          .filter(Boolean)
          .map(function (value) { return new Date(value); })
          .filter(function (value) { return !Number.isNaN(value.getTime()); });
        if (successfulTimes.length) {
          lastSuccessfulAt = new Date(Math.max.apply(null, successfulTimes.map(function (value) {
            return value.getTime();
          })));
        }
        checked.textContent = "Last check completed " + lastCompletedAt.toLocaleString() +
          " · latest successful environment check " +
          (lastSuccessfulAt ? lastSuccessfulAt.toLocaleString() : "none yet") +
          " · " + liveChecks + "/" + inspected.length + " live";
        checked.title = "Last attempt: " + lastAttemptAt.toISOString() +
          " · Completed: " + lastCompletedAt.toISOString() +
          (lastSuccessfulAt
            ? " · Latest successful environment check: " + lastSuccessfulAt.toISOString()
            : "");
      } catch {
        lastCompletedAt = new Date();
        const failed = [...snapshots.values()].map(function (snapshot) {
          return failedInspection(snapshot.item);
        });
        grid.replaceChildren(...failed.map(createCard));
        renderPipeline();
        renderEvents();
        checked.textContent = "Last check failed " + lastCompletedAt.toLocaleString() +
          " · latest successful environment check " +
          (lastSuccessfulAt ? lastSuccessfulAt.toLocaleString() : "none yet") +
          " · retrying automatically";
      } finally {
        grid.setAttribute("aria-busy", "false");
      }
    })();
    try { await statusRequest; } finally { statusRequest = null; }
  }

  initialEnvironments.forEach(function (item) {
    const snapshot = {
      item: item,
      health: null,
      overview: null,
      healthFresh: false,
      telemetryFresh: false,
      healthState: "unknown",
      telemetryState: "unknown",
      loading: true,
    };
    snapshots.set(item.key, snapshot);
    grid.append(createCard(snapshot));
  });
  renderPipeline();
  renderTabs();
  renderEvents();
  void loadStatus();
  setInterval(function () { void loadStatus(); }, 300000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" &&
      (!lastAttemptAt || Date.now() - lastAttemptAt.getTime() >= refreshIntervalMs)) {
      void loadStatus();
    }
  });
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) void loadStatus();
  });
`;

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self' https://chessriot.ripper234.chatgpt.site https://chessriot-staging.ripper234.chatgpt.site https://chessriot-dev.ripper234.chatgpt.site; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return statusResponse(env);
    }
    if (request.method === "POST" && url.pathname === "/api/registry/observation") {
      return observationResponse(request, env);
    }
    if (request.method === "GET" && url.pathname === "/control.js") {
      return new Response(clientScript, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method !== "GET" || url.pathname !== "/") {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    return new Response(page, { headers: securityHeaders });
  },
};
