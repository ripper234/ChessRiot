const ENVIRONMENTS = [
  {
    key: "development",
    name: "Dev",
    deployedVersionKey: "DEV_DEPLOYED_VERSION",
    urlKey: "DEV_URL",
    secretKey: "DEV_OPS_READ_SECRET",
    access: "Owner only",
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
    name: "Prod",
    deployedVersionKey: "PROD_DEPLOYED_VERSION",
    urlKey: "PROD_URL",
    secretKey: "PROD_OPS_READ_SECRET",
    access: "Public",
    accent: "gold",
  },
];

const CONTROL_VERSION = "0.5.0";
const STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEMO_VIDEO_MAX_BYTES = 45 * 1024 * 1024;
const DEMO_VIDEO_STORY_VERSION = 2;
const DEMO_ASSETS = new Map([
  ["home", "home.jpg"],
  ["solo", "solo.jpg"],
  ["game", "game.jpg"],
  ["themes", "themes.jpg"],
  ["multiplayer", "multiplayer.jpg"],
  ["invite", "invite-safe.jpg"],
  ["joined", "invite-safe.jpg"],
  ["replay", "game.jpg"],
  ["music", "demo-bed.mp3"],
]);
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

async function mintGrant(secret, audience, scope) {
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    aud: audience,
    scope,
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

export function summarizeFeedbackEnvironments(states) {
  let known = 0;
  let complete = Array.isArray(states) && states.length === 3;
  for (const state of states || []) {
    if (!state || !state.fresh || !state.exact) {
      complete = false;
      if (state && state.fresh && Number.isFinite(state.unresolved)) {
        known += Math.max(0, state.unresolved);
      }
      continue;
    }
    known += Math.max(0, state.unresolved);
  }
  return {
    known,
    complete,
    display: complete ? String(known) : (known ? String(known) + "+" : "?"),
  };
}

export function normalizeFeedbackOverview(overview) {
  if (!overview || typeof overview !== "object") return null;
  const candidate = overview.feedbackPool ?? overview.feedback;
  const counts = overview.feedbackCounts && typeof overview.feedbackCounts === "object"
    ? overview.feedbackCounts
    : candidate;
  let items = null;
  if (Array.isArray(candidate)) {
    items = candidate;
  } else if (candidate && Array.isArray(candidate.items)) {
    items = candidate.items;
  }
  if (!items) return null;
  const listedUnresolved = items.filter(function (entry) {
    return !entry || entry.status !== "closed";
  }).length;
  const exactUnresolved = counts && Number.isFinite(counts.unresolved)
    && counts.unresolved >= listedUnresolved;
  return {
    items,
    total: counts && Number.isFinite(counts.total) && counts.total >= items.length
      ? counts.total
      : items.length,
    unresolved: exactUnresolved ? counts.unresolved : listedUnresolved,
    exact: Boolean(exactUnresolved),
  };
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
      grant: await mintGrant(
        env[config.secretKey],
        config.key,
        "observability:read",
      ),
      feedbackGrant: await mintGrant(
        env[config.secretKey],
        config.key,
        "feedback:manage",
      ),
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

function controlMutationAuthorized(request, env) {
  const expectedEmail = String(env.VIDEO_REGEN_ALLOWED_EMAIL || "")
    .trim()
    .toLowerCase();
  const actualEmail = String(
    request.headers.get("oai-authenticated-user-email") || "",
  ).trim().toLowerCase();
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return Boolean(
    expectedEmail
    && actualEmail === expectedEmail
    && origin === new URL(request.url).origin
    && fetchSite === "same-origin",
  );
}

async function signDemoRequest(env, action, jobId, details) {
  const secret = String(env.VIDEO_REGEN_SHARED_SECRET || "");
  if (!secret) return null;
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const canonical = [
    "chessriot-demo-v1",
    action,
    jobId,
    timestamp,
    nonce,
    details,
  ].join("\n");
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
    new TextEncoder().encode(canonical),
  );
  return {
    "x-demo-video-job": jobId,
    "x-demo-video-timestamp": timestamp,
    "x-demo-video-nonce": nonce,
    "x-demo-video-signature": base64Url(new Uint8Array(signature)),
  };
}

function demoProxyJson(payload, status = 200) {
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

function devRequestHeaders(env, values = {}) {
  const bypass = String(env.DEV_SITES_BYPASS_TOKEN || "");
  if (!bypass) return null;
  return {
    ...values,
    "OAI-Sites-Authorization": `Bearer ${bypass}`,
  };
}

async function demoNarrationResponse(request, env) {
  if (!controlMutationAuthorized(request, env)) {
    return demoProxyJson({ error: "not_authorized" }, 403);
  }
  const devUrl = String(env.DEV_URL || "");
  const jobId = crypto.randomUUID();
  const storyVersion = String(DEMO_VIDEO_STORY_VERSION);
  const signed = await signDemoRequest(
    env,
    "narration",
    jobId,
    storyVersion,
  );
  const upstreamHeaders = signed ? devRequestHeaders(env, {
    ...signed,
    "x-demo-video-story-version": storyVersion,
  }) : null;
  if (!devUrl || !upstreamHeaders) {
    return demoProxyJson({ error: "generator_not_configured" }, 503);
  }
  let upstream;
  try {
    upstream = await fetch(devUrl + "/api/demo-video/narration", {
      method: "POST",
      headers: upstreamHeaders,
      redirect: "manual",
    });
  } catch {
    return demoProxyJson({ error: "generator_unavailable" }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    let error = "narration_failed";
    try {
      const payload = await upstream.json();
      if (typeof payload?.error === "string") error = payload.error;
    } catch {
      // Keep the bounded public error.
    }
    return demoProxyJson({ error }, upstream.status);
  }
  if (upstream.headers.get("x-demo-video-story-version") !== storyVersion) {
    return demoProxyJson({ error: "story_version_mismatch" }, 409);
  }
  return new Response(upstream.body, {
    headers: {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") || "audio/mpeg",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-demo-video-job": jobId,
      "x-demo-video-story-version": storyVersion,
    },
  });
}

async function demoPublishResponse(request, env) {
  if (!controlMutationAuthorized(request, env)) {
    return demoProxyJson({ error: "not_authorized" }, 403);
  }
  const jobId = request.headers.get("x-demo-video-job") || "";
  const bytes = Number(request.headers.get("x-demo-video-bytes") || "");
  const duration = Number(request.headers.get("x-demo-video-duration") || "");
  const sha256 = request.headers.get("x-demo-video-sha256") || "";
  const mimeType = request.headers.get("content-type") || "";
  const storyVersion = request.headers.get("x-demo-video-story-version") || "";
  const statedLength = Number(request.headers.get("content-length") || bytes);
  if (
    !/^[0-9a-f-]{36}$/i.test(jobId)
    || !Number.isInteger(bytes)
    || bytes < 100_000
    || bytes > DEMO_VIDEO_MAX_BYTES
    || !Number.isFinite(duration)
    || duration < 85
    || duration > 95
    || !/^[A-Za-z0-9_-]{43}$/.test(sha256)
    || !/^video\/webm(?:;|$)/.test(mimeType)
    || storyVersion !== String(DEMO_VIDEO_STORY_VERSION)
    || !request.body
    || statedLength !== bytes
  ) {
    return demoProxyJson({ error: "invalid_video" }, 400);
  }
  const details = [
    storyVersion,
    String(bytes),
    String(duration),
    mimeType,
    sha256,
  ].join("\n");
  const signed = await signDemoRequest(env, "publish", jobId, details);
  const devUrl = String(env.DEV_URL || "");
  const upstreamHeaders = signed ? devRequestHeaders(env, {
    ...signed,
    "content-type": mimeType,
    "x-demo-video-bytes": String(bytes),
    "x-demo-video-duration": String(duration),
    "x-demo-video-mime": mimeType,
    "x-demo-video-sha256": sha256,
    "x-demo-video-story-version": storyVersion,
  }) : null;
  if (!devUrl || !upstreamHeaders) {
    return demoProxyJson({ error: "generator_not_configured" }, 503);
  }
  let upstream;
  try {
    upstream = await fetch(devUrl + "/api/demo-video/publish", {
      method: "POST",
      headers: upstreamHeaders,
      body: request.body,
      redirect: "manual",
    });
  } catch {
    return demoProxyJson({ error: "publish_unavailable" }, 502);
  }
  let payload = { error: "publish_failed" };
  try {
    payload = await upstream.json();
  } catch {
    // Keep the bounded public error.
  }
  if (
    !upstream.ok
    || payload?.status !== "ready"
    || typeof payload?.generatedAt !== "string"
    || !Number.isFinite(Date.parse(payload.generatedAt))
    || payload?.storyVersion !== DEMO_VIDEO_STORY_VERSION
  ) {
    return demoProxyJson(
      { error: typeof payload?.error === "string" ? payload.error : "publish_failed" },
      upstream.ok ? 502 : upstream.status,
    );
  }
  return demoProxyJson(payload, upstream.status);
}

async function demoFailResponse(request, env) {
  if (!controlMutationAuthorized(request, env)) {
    return demoProxyJson({ error: "not_authorized" }, 403);
  }
  const jobId = request.headers.get("x-demo-video-job") || "";
  const errorCode = String(request.headers.get("x-demo-video-error") || "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 48);
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !errorCode) {
    return demoProxyJson({ error: "invalid_failure" }, 400);
  }
  const signed = await signDemoRequest(env, "fail", jobId, errorCode);
  const devUrl = String(env.DEV_URL || "");
  const upstreamHeaders = signed ? devRequestHeaders(env, {
    ...signed,
    "x-demo-video-error": errorCode,
  }) : null;
  if (!devUrl || !upstreamHeaders) {
    return demoProxyJson({ error: "generator_not_configured" }, 503);
  }
  try {
    await fetch(devUrl + "/api/demo-video/fail", {
      method: "POST",
      headers: upstreamHeaders,
      redirect: "manual",
    });
  } catch {
    // This notification is best effort; the server expires abandoned jobs.
  }
  return demoProxyJson({ status: "failed" });
}

async function demoStatusResponse(env) {
  const devUrl = String(env.DEV_URL || "");
  const upstreamHeaders = devRequestHeaders(env, { accept: "application/json" });
  if (!devUrl || !upstreamHeaders) {
    return demoProxyJson({ error: "generator_not_configured" }, 503);
  }
  try {
    const upstream = await fetch(devUrl + "/api/demo-video/status", {
      headers: upstreamHeaders,
      redirect: "manual",
    });
    if (!upstream.ok) throw new Error("status_failed");
    const payload = await upstream.json();
    return demoProxyJson(payload);
  } catch {
    return demoProxyJson({ error: "status_unavailable" }, 502);
  }
}

async function demoAssetResponse(name, env) {
  const file = DEMO_ASSETS.get(name);
  const devUrl = String(env.DEV_URL || "");
  const upstreamHeaders = devRequestHeaders(env);
  if (!file || !devUrl || !upstreamHeaders) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const upstream = await fetch(devUrl + "/demo-assets/" + file, {
      headers: upstreamHeaders,
      redirect: "manual",
    });
    if (!upstream.ok || !upstream.body) throw new Error("asset_failed");
    return new Response(upstream.body, {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-type": upstream.headers.get("content-type") || "image/jpeg",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Asset unavailable", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
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
      .feedback-launcher{position:relative;width:38px;height:38px;display:grid;place-items:center;padding:0;
        border:1px solid #43516a;border-radius:50%;color:#8d9bb3;background:#101625;cursor:pointer}
      .feedback-launcher svg{width:19px;height:19px;fill:currentColor}.feedback-launcher:hover{color:var(--text);
        border-color:#7183a4}.feedback-launcher[data-state=attention]{color:#fff;border-color:var(--pink);
        background:rgba(255,46,110,.17);box-shadow:0 0 18px rgba(255,46,110,.35)}
      .feedback-launcher[data-state=incomplete]{color:var(--gold);border-color:rgba(255,196,0,.62)}
      .feedback-badge{position:absolute;top:-5px;right:-7px;min-width:20px;height:20px;display:grid;place-items:center;
        padding:0 5px;border:2px solid var(--black);border-radius:999px;color:#fff;background:var(--pink);
        font:900 9px/1 var(--mono)}.feedback-badge[hidden]{display:none}
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
      .pipeline{display:grid;grid-template-columns:minmax(140px,1fr) 116px minmax(140px,1fr) 116px minmax(140px,1fr);
        align-items:stretch;gap:8px}.pipeline-node{min-width:0;display:flex;flex-direction:column;align-items:flex-start;
        padding:14px;border:1px solid var(--line);background:rgba(5,9,20,.6)}.pipeline-node.development{border-color:rgba(154,108,255,.55)}
      .pipeline-label{display:block;color:var(--muted);font:800 8px/1 var(--mono);letter-spacing:.8px}
      .pipeline-node b{display:block;width:calc(100% + 12px);margin:7px -6px 12px;padding:2px 6px 3px;overflow:hidden;
        color:var(--text);font:italic clamp(20px,2.2vw,24px)/1.15 var(--display);text-overflow:ellipsis;white-space:nowrap}
      .pipeline-open{min-height:31px;display:inline-flex;align-items:center;
        justify-content:center;margin-top:auto;padding:0 9px;border:1px solid rgba(0,229,255,.55);color:var(--cyan);
        background:rgba(0,229,255,.06);font:850 10px/1 var(--mono);letter-spacing:.5px;text-decoration:none;
        cursor:pointer}.pipeline-open:hover{border-color:var(--cyan);background:rgba(0,229,255,.13)}
      .pipeline-open:disabled{border-color:#35425d;color:#718099;background:transparent;cursor:wait}
      .pipeline-connector{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
        color:var(--muted);text-align:center}.pipeline-arrow{color:var(--cyan);font:900 16px/1 var(--mono)}
      .pipeline-action{width:100%;min-height:36px;padding:5px 7px;border:1px solid #44516a;color:var(--muted);
        background:#1a2438;font:850 9px/1.2 var(--mono);letter-spacing:.25px}.pipeline-action:disabled{opacity:1;cursor:not-allowed}
      .pipeline-action.promote{border-color:rgba(255,196,0,.58);color:var(--gold);
        background:rgba(255,196,0,.07);cursor:pointer}.pipeline-action.promote:hover:not(:disabled){
        border-color:var(--gold);background:rgba(255,196,0,.14)}.pipeline-action.sync{border-color:rgba(23,224,194,.4);color:var(--green);
        background:rgba(23,224,194,.04)}.pipeline-blocker{font:700 7px/1.35 var(--mono);text-transform:uppercase}
      .pipeline-node-actions{width:100%;display:grid;gap:7px;margin-top:auto}.pipeline-node-actions .pipeline-open{margin-top:0}
      .pipeline-switch{min-height:29px;padding:0 8px;border:1px solid #43516a;color:#aebbd0;background:transparent;
        cursor:pointer;font:800 8px/1 var(--mono);letter-spacing:.35px}.pipeline-switch:hover{border-color:var(--purple);color:#d8cbff}
      .authority-note{display:flex;align-items:flex-start;gap:9px;margin:14px 0 0;padding:10px 12px;border:1px solid rgba(255,196,0,.22);
        color:#b8c4d7;background:rgba(255,196,0,.035);font:650 10px/1.45 var(--mono)}.authority-note b{color:var(--gold)}
      dialog{width:min(680px,calc(100% - 28px));padding:0;border:1px solid rgba(255,196,0,.62);color:var(--text);
        background:#0d1526;box-shadow:0 24px 80px rgba(0,0,0,.65)}dialog::backdrop{background:rgba(2,5,12,.82)}
      .feedback-inbox-dialog{width:min(460px,100%);height:calc(100dvh - 62px);max-height:none;margin:62px 0 0 auto;
        border:0;border-left:1px solid #35445f;background:#0a1120}
      .feedback-inbox-dialog::backdrop{background:rgba(2,5,12,.58)}
      .feedback-inbox-shell{height:100%;display:flex;flex-direction:column}.feedback-inbox-header{display:flex;
        align-items:flex-start;justify-content:space-between;gap:18px;padding:19px;border-bottom:1px solid var(--line)}
      .feedback-inbox-header h2{margin:0;font:italic 27px/1 var(--display);text-transform:uppercase}
      .feedback-inbox-summary{margin:7px 0 0;color:var(--muted);font:750 9px/1.4 var(--mono)}
      .feedback-inbox-close{width:34px;height:34px;border:1px solid #43516a;color:#cbd5e6;background:transparent;
        cursor:pointer;font:700 22px/1 var(--ui)}.feedback-inbox-body{flex:1;overflow:auto;padding:14px}
      .feedback-environment-note{margin:0 0 9px;padding:9px 10px;border:1px solid rgba(255,196,0,.28);
        color:#d8c986;background:rgba(255,196,0,.04);font:700 9px/1.4 var(--mono)}
      .handoff-modal{padding:20px}.handoff-modal h2{margin:0;font:italic 28px/1 var(--display);text-transform:uppercase}
      .handoff-modal>p{margin:9px 0 14px;color:#b8c4d7;font-size:11px;line-height:1.5}.handoff-fields{
        display:grid;grid-template-columns:1fr auto;align-items:end;gap:8px;margin:0 0 12px}.handoff-fields[hidden]{display:none}
      .handoff-fields label{display:grid;gap:6px;color:var(--muted);font:750 8px/1 var(--mono);letter-spacing:.5px}
      .handoff-fields input{min-height:38px;padding:0 10px;border:1px solid #43516a;color:var(--text);background:var(--black);
        font:750 11px/1 var(--mono)}.handoff-generate{min-height:38px;padding:0 12px;border:1px solid var(--purple);
        color:#ddd3ff;background:rgba(154,108,255,.1);cursor:pointer;font:850 9px/1 var(--mono)}
      .handoff-command{max-height:330px;margin:0;padding:13px;overflow:auto;border:1px solid #33415d;color:#dbe4f4;
        background:#050914;font:650 10px/1.55 var(--mono);white-space:pre-wrap}.handoff-actions{display:flex;flex-wrap:wrap;
        justify-content:flex-end;gap:8px;margin-top:14px}.handoff-actions button,.handoff-actions a{min-height:36px;display:inline-flex;
        align-items:center;justify-content:center;padding:0 12px;border:1px solid #43516a;color:#c2cede;background:transparent;
        cursor:pointer;font:850 9px/1 var(--mono);text-decoration:none}.handoff-actions .copy-handoff{border-color:var(--gold);
        color:var(--black);background:var(--gold)}.handoff-actions .copy-handoff:disabled{opacity:.45;cursor:not-allowed}
      .drawer{margin-top:14px;border:1px solid var(--line);background:rgba(5,9,20,.48)}.drawer>summary{display:flex;
        align-items:center;justify-content:flex-start;gap:14px;padding:15px 17px;color:var(--text);cursor:pointer;
        list-style:none;font:italic 22px/1 var(--display);text-transform:uppercase}.drawer>summary::-webkit-details-marker{display:none}
      .drawer>summary:after{content:"+";margin-left:auto;color:var(--cyan);font:700 22px/1 var(--ui)}.drawer[open]>summary:after{content:"−"}
      .summary-title{display:inline-flex;align-items:baseline;gap:7px}
      .drawer-count{margin-left:7px;color:var(--cyan);font:750 10px/1 var(--mono);letter-spacing:.3px}.drawer-body{padding:0 17px 17px}
      .preview-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;padding:15px;
        border:1px solid rgba(154,108,255,.5);background:linear-gradient(135deg,rgba(154,108,255,.1),rgba(17,26,45,.72))}
      .preview-card h2{margin:0 0 5px;font:italic 23px/1 var(--display);text-transform:uppercase}.preview-meta{
        margin:0;color:#b8c4d7;font:700 9px/1.55 var(--mono)}.preview-meta b{color:var(--purple)}.preview-actions{
        display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.preview-actions a{min-height:32px;display:inline-flex;
        align-items:center;padding:0 10px;border:1px solid rgba(0,229,255,.42);color:var(--cyan);
        font:800 9px/1 var(--mono);text-decoration:none}.preview-actions a.secondary{border-color:#43516a;color:#b8c4d7}
      .demo-control{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,420px);gap:18px;padding:16px;
        border:1px solid rgba(0,229,255,.42);background:linear-gradient(135deg,rgba(0,229,255,.07),rgba(17,26,45,.78))}
      .demo-control h2{margin:0;font:italic 26px/1 var(--display);text-transform:uppercase}.demo-copy{
        margin:8px 0 0;color:#b8c4d7;font:650 11px/1.5 var(--ui)}.demo-status{display:flex;align-items:center;
        gap:8px;margin:13px 0 0;color:var(--muted);font:800 9px/1.35 var(--mono)}.demo-status[data-state=working]{
        color:var(--cyan)}.demo-status[data-state=success]{color:var(--green)}.demo-status[data-state=error]{color:#ff8cab}
      .demo-indicator{width:10px;height:10px;border:1px solid currentColor;transform:rotate(45deg)}.demo-status[data-state=working] .demo-indicator{
        border-radius:50%;border-top-color:transparent;animation:spin 800ms linear infinite}.demo-status[data-state=success] .demo-indicator{
        background:var(--green)}.demo-status[data-state=error] .demo-indicator{background:#ff8cab}
      @keyframes spin{to{transform:rotate(405deg)}}.demo-actions-panel{display:grid;gap:9px;align-content:start}
      .demo-regenerate{min-height:48px;padding:0 16px;border:1px solid var(--gold);color:var(--black);
        background:var(--gold);cursor:pointer;font:900 10px/1.2 var(--mono);letter-spacing:.6px}
      .demo-regenerate:hover:not(:disabled){filter:brightness(1.08)}.demo-regenerate:disabled{cursor:wait;opacity:.62}
      .demo-open{min-height:36px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,229,255,.46);
        color:var(--cyan);font:850 9px/1 var(--mono);text-decoration:none}.demo-note{margin:0;color:#8797af;
        font:650 8px/1.45 var(--mono)}.demo-preview{display:none;width:100%;aspect-ratio:16/9;margin-top:14px;
        border:1px solid #35445f;background:#050914}.demo-preview.visible{display:block}
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
      .feedback-list{display:grid;gap:8px}
      .feedback-item{padding:13px;border:1px solid #2b3956;background:rgba(17,26,45,.72)}
      .feedback-item[data-status=closed]{opacity:.72}.feedback-item-top{display:flex;align-items:flex-start;
        justify-content:space-between;gap:12px}.feedback-environment{flex:0 0 auto;padding:4px 6px;border:1px solid #43516a;
        color:var(--cyan);font:850 8px/1 var(--mono);text-transform:uppercase}
      .feedback-item strong{display:block;font-size:12px}.feedback-item p{margin:7px 0 0;color:#c0cbde;font-size:11px;
        line-height:1.5;white-space:pre-wrap}.feedback-meta{display:block;margin-top:9px;color:var(--muted);
        font:700 8px/1.35 var(--mono)}
      .feedback-done{min-height:31px;margin-top:11px;padding:0 10px;border:1px solid rgba(23,224,194,.55);
        color:var(--green);background:rgba(23,224,194,.06);cursor:pointer;font:850 8px/1 var(--mono)}
      .feedback-done:disabled{border-color:#3b465a;color:#748199;background:transparent;cursor:not-allowed}
      .feedback-completed{margin-top:13px;border-top:1px solid var(--line);padding-top:11px}.feedback-completed>summary{
        color:var(--muted);cursor:pointer;font:800 9px/1 var(--mono);text-transform:uppercase}
      .feedback-completed .feedback-list{margin-top:10px}
      button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
      @media(max-width:980px){.pipeline{grid-template-columns:1fr}.pipeline-node b{font-size:clamp(22px,7vw,24px)}
        .pipeline-connector{min-height:62px}.pipeline-arrow{transform:rotate(90deg)}
        .pipeline-action{width:min(260px,100%)}.environment-summary{grid-template-columns:100px 1fr}.metrics{grid-column:1/-1}}
      @media(max-width:680px){.topbar{padding:10px 13px}.brand strong{font-size:21px}.brand small{display:none}
        .github{width:38px;padding:0;justify-content:center}.github span{display:none}.github.releases-link{width:auto;padding:0 10px}main{padding:14px 10px 40px}.release-board{padding:14px}
        .hero{flex-direction:column}.auto{max-width:none;width:100%}.drawer>summary{font-size:19px}.environment-summary{grid-template-columns:1fr}
        .preview-card{grid-template-columns:1fr}.preview-actions{justify-content:flex-start}
        .demo-control{grid-template-columns:1fr}
        .metrics{grid-template-columns:repeat(2,1fr)}.card-tools{align-items:flex-start;flex-direction:column}.actions{grid-template-columns:1fr}
        .handoff-fields{grid-template-columns:1fr}.handoff-actions{justify-content:stretch}.handoff-actions button,.handoff-actions a{flex:1}
        .feedback-inbox-dialog{width:100%;height:calc(100dvh - 58px);margin-top:58px}.drawer-body{padding:0 11px 11px;overflow:auto}.events-head{align-items:start;flex-direction:column}
        .event-table{min-width:680px}.release{grid-template-columns:66px 1fr}.release a{grid-column:2}}
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand"><span class="mark">♞</span><strong>ChessRiot Control</strong></div>
      <nav class="header-links" aria-label="Project links">
        <button class="feedback-launcher" id="feedback-launcher" type="button"
          aria-label="Feedback status is loading" aria-controls="feedback-inbox"
          aria-expanded="false" data-state="incomplete">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5v2h12V8H6Zm0 4v2h8v-2H6Z"/></svg>
          <span class="feedback-badge" id="feedback-badge">?</span>
        </button>
        <a class="github releases-link" href="https://chessriot.ripper234.chatgpt.site/changelog" target="_blank" rel="noopener noreferrer">Releases</a>
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
        <p class="authority-note"><span aria-hidden="true">⚿</span><span><b>Direct deployment is not connected.</b> The active controls prepare a manual ChatGPT Work request. Paste it into Work to perform and verify the deployment. Control itself changes nothing.</span></p>
      </section>
      <details class="drawer">
        <summary><span class="summary-title">Feature previews <span class="drawer-count">1 · ISOLATED</span></span></summary>
        <div class="drawer-body">
          <article class="preview-card">
            <div>
              <h2>Magic Rules compiler</h2>
              <p class="preview-meta"><b>feature/runtime-magic-rules</b><br>v0.11.0-magic.4 · Separate database · Owner only</p>
            </div>
            <div class="preview-actions">
              <a href="https://chessriot-magic-preview.ripper234.chatgpt.site" target="_blank" rel="noopener noreferrer">OPEN PREVIEW</a>
              <a class="secondary" href="https://github.com/ripper234/ChessRiot/tree/feature/runtime-magic-rules" target="_blank" rel="noopener noreferrer">VIEW BRANCH</a>
              <a class="secondary" href="https://github.com/ripper234/ChessRiot/branches" target="_blank" rel="noopener noreferrer">ALL BRANCHES</a>
            </div>
          </article>
        </div>
      </details>
      <details class="drawer" id="demo-video-control">
        <summary><span class="summary-title">Demo video <span class="drawer-count" id="demo-video-badge">1:30 · DEV</span></span></summary>
        <div class="drawer-body">
          <section class="demo-control">
            <div>
              <h2>Story-first 90-second explainer</h2>
              <p class="demo-copy">Ron and Omri carry one game through a real day. Regeneration replaces only the media asset and does not deploy ChessRiot.</p>
              <p class="demo-status" id="demo-video-status" data-state="idle" role="status" aria-live="polite">
                <span class="demo-indicator" aria-hidden="true"></span>
                <span id="demo-video-status-text">Checking the current video…</span>
              </p>
              <canvas class="demo-preview" id="demo-video-canvas" width="1280" height="720" aria-label="Demo video render preview"></canvas>
            </div>
            <div class="demo-actions-panel">
              <button class="demo-regenerate" id="demo-video-regenerate" type="button">REGENERATE 90-SEC VIDEO</button>
              <a class="demo-open" href="https://chessriot-dev.ripper234.chatgpt.site/demo" target="_blank" rel="noopener noreferrer">OPEN DEMO ↗</a>
              <p class="demo-note">Keep this tab open for about 90 seconds. The fixed script uses the Dev OpenAI key, with one active job, a 30-minute cooldown, and hard daily/monthly limits. The voice is AI-generated.</p>
            </div>
          </section>
        </div>
      </details>
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
    </main>
    <dialog class="feedback-inbox-dialog" id="feedback-inbox" aria-labelledby="feedback-inbox-title">
      <section class="feedback-inbox-shell">
        <header class="feedback-inbox-header">
          <div>
            <h2 id="feedback-inbox-title">Feedback inbox</h2>
            <p class="feedback-inbox-summary" id="feedback-inbox-summary" aria-live="polite">Checking all environments…</p>
          </div>
          <button class="feedback-inbox-close" id="feedback-inbox-close" type="button" aria-label="Close feedback inbox">×</button>
        </header>
        <div class="feedback-inbox-body">
          <div id="feedback-unresolved"><p class="empty">Loading unresolved feedback…</p></div>
          <details class="feedback-completed" id="feedback-completed" hidden>
            <summary id="feedback-completed-summary">Completed (0)</summary>
            <div class="feedback-list" id="feedback-completed-list"></div>
          </details>
        </div>
      </section>
    </dialog>
    <dialog id="release-handoff" aria-labelledby="handoff-title">
      <section class="handoff-modal">
        <h2 id="handoff-title">Run in ChatGPT Work</h2>
        <p>This is a temporary manual handoff, not deployment automation. Copy the request, paste it into a ChatGPT Work chat, and let Work verify the exact artifact before changing one environment.</p>
        <div class="handoff-fields" id="handoff-fields" hidden>
          <label for="handoff-version">TARGET STABLE RELEASE
            <input id="handoff-version" inputmode="decimal" autocomplete="off" placeholder="e.g. 0.10.2">
          </label>
          <button class="handoff-generate" id="handoff-generate" type="button">PREPARE REQUEST</button>
        </div>
        <pre class="handoff-command" id="handoff-command"></pre>
        <div class="handoff-actions">
          <button id="handoff-cancel" type="button">CANCEL</button>
          <button class="copy-handoff" id="handoff-copy" type="button">COPY WORK REQUEST</button>
          <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">OPEN CHATGPT ↗</a>
        </div>
      </section>
    </dialog>
    <script src="/control.js" defer></script>
  </body>
</html>`;

const clientScript = String.raw`
  ${summarizeFeedbackEnvironments.toString()}
  ${normalizeFeedbackOverview.toString()}
  const grid = document.querySelector("#grid");
  const pipeline = document.querySelector("#pipeline");
  const checked = document.querySelector("#checked");
  const tabs = document.querySelector("#tabs");
  const eventContent = document.querySelector("#event-content");
  const feedbackLauncher = document.querySelector("#feedback-launcher");
  const feedbackBadge = document.querySelector("#feedback-badge");
  const feedbackInbox = document.querySelector("#feedback-inbox");
  const feedbackInboxSummary = document.querySelector("#feedback-inbox-summary");
  const feedbackUnresolved = document.querySelector("#feedback-unresolved");
  const feedbackCompleted = document.querySelector("#feedback-completed");
  const feedbackCompletedSummary = document.querySelector("#feedback-completed-summary");
  const feedbackCompletedList = document.querySelector("#feedback-completed-list");
  const demoStatus = document.querySelector("#demo-video-status");
  const demoStatusText = document.querySelector("#demo-video-status-text");
  const demoBadge = document.querySelector("#demo-video-badge");
  const demoButton = document.querySelector("#demo-video-regenerate");
  const demoCanvas = document.querySelector("#demo-video-canvas");
  const demoContext = demoCanvas.getContext("2d");
  const handoffDialog = document.querySelector("#release-handoff");
  const handoffTitle = document.querySelector("#handoff-title");
  const handoffFields = document.querySelector("#handoff-fields");
  const handoffVersion = document.querySelector("#handoff-version");
  const handoffGenerate = document.querySelector("#handoff-generate");
  const handoffCommand = document.querySelector("#handoff-command");
  const handoffCopy = document.querySelector("#handoff-copy");
  let pendingSwitchStage = null;
  const demoScenes = [
    { start: 0, end: 14.5, asset: "home", title: "FIND THE TIME" },
    { start: 14.5, end: 19, asset: "solo", title: "START IN SECONDS" },
    { start: 19, end: 30, asset: "game", title: "A QUICK WARM-UP" },
    { start: 30, end: 39, asset: "themes", title: "MAKE IT THEIRS" },
    { start: 39, end: 51, asset: "multiplayer", title: "THE REAL MATCH" },
    { start: 51, end: 56.5, asset: "invite", title: "ONE PRIVATE INVITE" },
    { start: 56.5, end: 67, asset: "joined", title: "RON MOVES FIRST" },
    { start: 67, end: 83, asset: "replay", title: "LIFE INTERRUPTS" },
    { start: 83, end: 90, asset: "home", title: "STILL MOVING" },
  ];
  const demoCaptions = [
    { start: .5, end: 5.5, lines: ["Ron and Omri love chess.", ""] },
    { start: 5.5, end: 10, lines: ["The problem is finding an hour", "when both are free."] },
    { start: 10, end: 14.5, lines: ["ChessRiot turns spare minutes", "into a game that keeps moving."] },
    { start: 14.5, end: 19, lines: ["Ron enters his name and starts.", "No account. No CAPTCHA."] },
    { start: 19, end: 24.5, lines: ["Solo is ready for a warm-up.", "Choose one of five Riot Bot levels."] },
    { start: 24.5, end: 30, lines: ["Move by drag, tap, click,", "or keyboard."] },
    { start: 30, end: 34.5, lines: ["Their game should feel like theirs.", ""] },
    { start: 34.5, end: 39, lines: ["Open Themes and transform", "the board into Blockfield."] },
    { start: 39, end: 44.5, lines: ["Now the real match.", "Switch to Multiplayer."] },
    { start: 44.5, end: 51, lines: ["Choose three days per move", "and create the game."] },
    { start: 51, end: 56.5, lines: ["ChessRiot creates one private", "invitation for Omri."] },
    { start: 56.5, end: 62.5, lines: ["It waits safely for Omri.", "When he claims Black…"] },
    { start: 62.5, end: 67, lines: ["Ron has White, so he moves first.", "Every move is saved."] },
    { start: 67, end: 72, lines: ["Ron closes the browser.", "Nothing is lost."] },
    { start: 72, end: 78, lines: ["Each player can return through", "a private seat link."] },
    { start: 78, end: 83.5, lines: ["The same saved board and", "full history are waiting."] },
    { start: 83.5, end: 87, lines: ["Step back, replay,", "then return live."] },
    { start: 87, end: 89, lines: ["Real chess that survives real life.", ""] },
    { start: 89, end: 89.9, lines: ["One game, still moving.", ""] },
  ];
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

  function setDemoStatus(state, text) {
    demoStatus.dataset.state = state;
    demoStatusText.textContent = text;
  }

  async function demoJson(response) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const failure = new Error(payload && payload.error
        ? String(payload.error)
        : "demo_request_failed");
      failure.code = payload && payload.error ? String(payload.error) : "demo_request_failed";
      throw failure;
    }
    return payload;
  }

  async function refreshDemoStatus() {
    try {
      const response = await fetch("/api/demo-video/status", { cache: "no-store" });
      const status = await demoJson(response);
      if (status.source === "generated" && status.generatedAt) {
        const generated = new Date(status.generatedAt);
        setDemoStatus("success", "Latest generated video: " + generated.toLocaleString());
        demoBadge.textContent = "1:30 · GENERATED";
      } else {
        setDemoStatus("idle", "Bundled 90-second video is live in Development.");
        demoBadge.textContent = "1:30 · DEV";
      }
    } catch {
      setDemoStatus("error", "Could not verify the current video.");
    }
  }

  function loadDemoImage(name) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.decoding = "async";
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("asset_failed")); };
      image.src = "/api/demo-video/assets/" + name;
    });
  }

  function drawDemoFrame(time, images) {
    const sceneIndex = demoScenes.findIndex(function (candidate) {
      return time >= candidate.start && time < candidate.end;
    });
    const resolvedIndex = sceneIndex >= 0 ? sceneIndex : demoScenes.length - 1;
    const scene = demoScenes[resolvedIndex];
    const image = images[scene.asset];
    const progress = Math.max(0, Math.min(1, (time - scene.start) / (scene.end - scene.start)));
    demoContext.fillStyle = "#071019";
    demoContext.fillRect(0, 0, 1280, 720);
    function drawImageFrame(target, targetProgress, alpha) {
      const baseScale = Math.max(1280 / target.width, 720 / target.height);
      const zoom = 1 + targetProgress * 0.025;
      const width = target.width * baseScale * zoom;
      const height = target.height * baseScale * zoom;
      demoContext.save();
      demoContext.globalAlpha = alpha;
      demoContext.drawImage(
        target,
        (1280 - width) / 2,
        (720 - height) / 2,
        width,
        height,
      );
      demoContext.restore();
    }
    drawImageFrame(image, progress, 1);
    const transitionProgress = Math.max(0, (progress - 0.94) / 0.06);
    const nextScene = demoScenes[resolvedIndex + 1];
    if (nextScene && transitionProgress > 0) {
      drawImageFrame(images[nextScene.asset], 0, transitionProgress);
    }
    const vignette = demoContext.createLinearGradient(0, 0, 0, 720);
    vignette.addColorStop(0, "rgba(7,16,25,.2)");
    vignette.addColorStop(.62, "rgba(7,16,25,0)");
    vignette.addColorStop(1, "rgba(7,16,25,.45)");
    demoContext.fillStyle = vignette;
    demoContext.fillRect(0, 0, 1280, 720);
    demoContext.fillStyle = "rgba(7,16,25,.9)";
    demoContext.fillRect(28, 24, 430, 36);
    demoContext.fillRect(930, 24, 322, 36);
    demoContext.fillStyle = "#63c8dd";
    demoContext.font = "800 16px Arial";
    demoContext.fillText("CHESSRIOT · ONE GAME, STILL MOVING", 44, 48);
    demoContext.textAlign = "right";
    demoContext.fillStyle = "#ffd65a";
    demoContext.font = "800 16px Arial";
    demoContext.fillText(scene.title, 1238, 48);
    demoContext.textAlign = "start";
    demoContext.fillStyle = "rgba(255,214,90,.22)";
    demoContext.fillRect(0, 712, 1280, 8);
    demoContext.fillStyle = "#ffd65a";
    demoContext.fillRect(0, 712, 1280 * Math.min(time / 90, 1), 8);
    const caption = demoCaptions.find(function (candidate) {
      return time >= candidate.start && time < candidate.end;
    });
    if (caption) {
      demoContext.fillStyle = "rgba(7,16,25,.9)";
      demoContext.fillRect(64, 588, 1152, 104);
      demoContext.textAlign = "center";
      demoContext.fillStyle = "#ffffff";
      demoContext.font = "700 27px Arial";
      demoContext.fillText(caption.lines[0], 640, caption.lines[1] ? 630 : 651);
      if (caption.lines[1]) {
        demoContext.fillText(caption.lines[1], 640, 666);
      }
      demoContext.textAlign = "start";
    }
  }

  function supportedDemoMime() {
    const options = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return options.find(function (value) {
      return window.MediaRecorder && MediaRecorder.isTypeSupported(value);
    }) || null;
  }

  async function renderDemoVideo(
    narrationBuffer,
    musicBuffer,
    audioContext,
    images,
    mimeType,
  ) {
    const destination = audioContext.createMediaStreamDestination();
    const narrationSource = audioContext.createBufferSource();
    const musicSource = audioContext.createBufferSource();
    const narrationGain = audioContext.createGain();
    const musicGain = audioContext.createGain();
    const silentMonitor = audioContext.createGain();
    narrationGain.gain.value = 1;
    musicGain.gain.value = 0.16;
    silentMonitor.gain.value = 0;
    narrationSource.buffer = narrationBuffer;
    musicSource.buffer = musicBuffer;
    musicSource.loop = true;
    narrationSource.connect(narrationGain);
    musicSource.connect(musicGain);
    narrationGain.connect(destination);
    musicGain.connect(destination);
    narrationGain.connect(silentMonitor);
    musicGain.connect(silentMonitor);
    silentMonitor.connect(audioContext.destination);
    const canvasStream = demoCanvas.captureStream(30);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("audio_capture_unavailable");
    canvasStream.addTrack(audioTrack);
    const chunks = [];
    const recorder = new MediaRecorder(canvasStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 3_000_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise(function (resolve, reject) {
      recorder.onerror = function () { reject(new Error("media_recorder_failed")); };
      recorder.onstop = function () { resolve(); };
    });
    demoCanvas.classList.add("visible");
    drawDemoFrame(0, images);
    recorder.start(1000);
    const startedAt = performance.now();
    musicSource.start(audioContext.currentTime);
    narrationSource.start(audioContext.currentTime + 0.5);
    let lastSecond = -1;
    let renderFailure = null;
    try {
      await new Promise(function (resolve, reject) {
        let cancelled = false;
        const abortHidden = function () {
          if (document.visibilityState !== "visible" && !cancelled) {
            cancelled = true;
            reject(new Error("tab_hidden"));
          }
        };
        document.addEventListener("visibilitychange", abortHidden);
      function frame(now) {
        if (cancelled) {
          document.removeEventListener("visibilitychange", abortHidden);
          return;
        }
        const elapsed = Math.min((now - startedAt) / 1000, 90);
        drawDemoFrame(elapsed, images);
        const second = Math.floor(elapsed);
        if (second !== lastSecond) {
          lastSecond = second;
          setDemoStatus(
            "working",
            "Rendering " + Math.min(100, Math.floor(elapsed / 90 * 100)) + "% · keep this tab open",
          );
        }
        if (elapsed >= 90) {
          cancelled = true;
          document.removeEventListener("visibilitychange", abortHidden);
          resolve();
        }
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      });
    } catch (error) {
      renderFailure = error;
    }
    try { narrationSource.stop(); } catch {}
    try { musicSource.stop(); } catch {}
    recorder.stop();
    await stopped;
    for (const track of canvasStream.getTracks()) track.stop();
    await audioContext.close();
    if (renderFailure) throw renderFailure;
    return new Blob(chunks, { type: mimeType });
  }

  function demoBytesContain(bytes, value, limit) {
    const needle = new TextEncoder().encode(value);
    const end = Math.min(bytes.length, limit || bytes.length);
    outer: for (let index = 0; index <= end - needle.length; index += 1) {
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (bytes[index + offset] !== needle[offset]) continue outer;
      }
      return true;
    }
    return false;
  }

  function demoBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  async function validateDemoBlob(blob) {
    if (blob.size < 100000 || blob.size > ${DEMO_VIDEO_MAX_BYTES}) {
      throw new Error("invalid_video");
    }
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (
      bytes[0] !== 0x1a
      || bytes[1] !== 0x45
      || bytes[2] !== 0xdf
      || bytes[3] !== 0xa3
      || !demoBytesContain(bytes, "webm", 4096)
      || !demoBytesContain(bytes, "OpusHead")
      || !(
        demoBytesContain(bytes, "V_VP8", 16384)
        || demoBytesContain(bytes, "V_VP9", 16384)
      )
    ) {
      throw new Error("invalid_video");
    }
    const objectUrl = URL.createObjectURL(blob);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = objectUrl;
    let measuredDuration = 90;
    try {
      await new Promise(function (resolve, reject) {
        const timeout = setTimeout(function () {
          reject(new Error("invalid_video"));
        }, 10000);
        probe.onloadedmetadata = function () {
          clearTimeout(timeout);
          resolve();
        };
        probe.onerror = function () {
          clearTimeout(timeout);
          reject(new Error("invalid_video"));
        };
      });
      if (probe.videoWidth !== 1280 || probe.videoHeight !== 720) {
        throw new Error("invalid_video");
      }
      if (
        Number.isFinite(probe.duration)
        && (probe.duration < 85 || probe.duration > 95)
      ) {
        throw new Error("invalid_video");
      }
      if (Number.isFinite(probe.duration)) measuredDuration = probe.duration;
    } finally {
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(objectUrl);
    }
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return {
      bytes: blob.size,
      duration: measuredDuration,
      sha256: demoBase64Url(new Uint8Array(digest)),
    };
  }

  function demoFailureMessage(code) {
    const messages = {
      generation_in_progress: "Another video is already being generated.",
      generation_cooldown: "Regeneration is limited to once every 30 minutes.",
      generation_budget_reached: "The demo-video generation budget has been reached.",
      narration_failed: "Narration generation failed.",
      narration_rate_limited: "The narration service is rate-limited. Try later.",
      not_authorized: "This action is restricted to the Control owner.",
      publish_failed: "The video rendered, but publishing failed.",
      invalid_video: "The rendered video did not pass validation.",
      story_version_mismatch: "The video recipe changed. Refresh Control and retry.",
      tab_hidden: "Rendering stopped because this tab was hidden. Keep it visible and try again.",
    };
    return messages[code] || "Video regeneration failed.";
  }

  async function reportDemoFailure(jobId, code) {
    if (!jobId) return;
    try {
      await fetch("/api/demo-video/fail", {
        method: "POST",
        headers: {
          "x-demo-video-job": jobId,
          "x-demo-video-error": code,
        },
      });
    } catch {}
  }

  async function regenerateDemoVideo() {
    if (!window.confirm(
      "Regenerate the 90-second Development demo now? This uses one AI narration request and takes about 90 seconds.",
    )) return;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    const mimeType = supportedDemoMime();
    if (!AudioContextConstructor || !demoCanvas.captureStream || !mimeType) {
      setDemoStatus("error", "This browser cannot render the video. Use current Chrome.");
      return;
    }
    demoButton.disabled = true;
    let jobId = null;
    let audioContext = null;
    const preventClose = function (event) {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventClose);
    try {
      audioContext = new AudioContextConstructor();
      await audioContext.resume();
      setDemoStatus("working", "Generating the AI narration…");
      const assetsPromise = Promise.all(
        ["home", "solo", "game", "themes", "multiplayer", "invite", "joined", "replay"].map(function (name) {
          return loadDemoImage(name).then(function (image) { return [name, image]; });
        }),
      ).then(function (entries) { return Object.fromEntries(entries); });
      const musicPromise = fetch("/api/demo-video/assets/music")
        .then(function (response) {
          if (!response.ok) throw new Error("asset_failed");
          return response.arrayBuffer();
        })
        .then(function (bytes) {
          return audioContext.decodeAudioData(bytes.slice(0));
        });
      const narrationResponse = await fetch("/api/demo-video/narration", {
        method: "POST",
      });
      if (!narrationResponse.ok) {
        const payload = await demoJson(narrationResponse);
        throw new Error(payload && payload.error ? payload.error : "narration_failed");
      }
      jobId = narrationResponse.headers.get("x-demo-video-job");
      if (
        narrationResponse.headers.get("x-demo-video-story-version")
        !== String(${DEMO_VIDEO_STORY_VERSION})
      ) throw new Error("story_version_mismatch");
      const audioBytes = await narrationResponse.arrayBuffer();
      const [audioBuffer, musicBuffer, images] = await Promise.all([
        audioContext.decodeAudioData(audioBytes.slice(0)),
        musicPromise,
        assetsPromise,
      ]);
      const video = await renderDemoVideo(
        audioBuffer,
        musicBuffer,
        audioContext,
        images,
        mimeType,
      );
      audioContext = null;
      setDemoStatus("working", "Validating and publishing the new video…");
      const validation = await validateDemoBlob(video);
      const publishResponse = await fetch("/api/demo-video/publish", {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "x-demo-video-job": jobId,
          "x-demo-video-bytes": String(validation.bytes),
          "x-demo-video-duration": String(validation.duration),
          "x-demo-video-sha256": validation.sha256,
          "x-demo-video-story-version": String(${DEMO_VIDEO_STORY_VERSION}),
        },
        body: video,
      });
      const result = await demoJson(publishResponse);
      if (
        result.status !== "ready"
        || typeof result.generatedAt !== "string"
        || !Number.isFinite(Date.parse(result.generatedAt))
        || result.storyVersion !== ${DEMO_VIDEO_STORY_VERSION}
      ) {
        throw new Error("publish_failed");
      }
      setDemoStatus(
        "success",
        "Video published ✓ · " + new Date(result.generatedAt).toLocaleString(),
      );
      demoBadge.textContent = "1:30 · GENERATED";
    } catch (error) {
      const code = error && (error.code || error.message)
        ? String(error.code || error.message)
        : "generation_failed";
      await reportDemoFailure(jobId, code.replace(/[^a-z0-9_]/g, "").slice(0, 48));
      setDemoStatus("error", demoFailureMessage(code));
      if (audioContext) {
        try { await audioContext.close(); } catch {}
      }
    } finally {
      window.removeEventListener("beforeunload", preventClose);
      demoButton.disabled = false;
    }
  }

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

  async function fetchFreshStatusEnvironment(key) {
    const response = await fetchProbe("/api/status", { cache: "no-store" });
    if (!response.ok || !response.data || !Array.isArray(response.data.environments)) {
      throw new Error("status_unavailable");
    }
    const item = response.data.environments.find(function (candidate) {
      return candidate.key === key;
    });
    if (!item) throw new Error("environment_missing");
    return item;
  }

  async function refreshFeedbackEnvironment(item) {
    if (!item.url || !item.grant) throw new Error("feedback_read_unavailable");
    const response = await fetchProbe(item.url + "/api/ops/overview", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: item.grant,
      cache: "no-store",
      credentials: item.access === "Owner only" ? "include" : "omit",
    });
    const probe = probeState({ status: "fulfilled", value: response }, item.key);
    if (!probe.fresh) throw new Error("feedback_refresh_failed");
    const previous = snapshots.get(item.key);
    snapshots.set(item.key, {
      ...previous,
      item: item,
      overview: probe.data,
      telemetryFresh: true,
      telemetryState: probe.state,
      lastTelemetryAt: new Date(),
    });
    renderFeedbackInbox();
  }

  async function markFeedbackDone(environmentKey, feedbackId, button) {
    if (!feedbackId) return;
    button.disabled = true;
    button.textContent = "MARKING DONE…";
    try {
      const item = await fetchFreshStatusEnvironment(environmentKey);
      if (!item.url || !item.feedbackGrant) {
        button.textContent = "MARK DONE UNAVAILABLE";
        return;
      }
      const result = await fetchProbe(
        item.url + "/api/ops/feedback/" + encodeURIComponent(feedbackId) + "/close",
        {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: item.feedbackGrant,
          cache: "no-store",
          credentials: item.access === "Owner only" ? "include" : "omit",
        },
      );
      if (result.status === 404) {
        button.textContent = "MARK DONE UNAVAILABLE";
        return;
      }
      if (result.status === 401 || result.status === 403) {
        button.textContent = "AUTHORIZATION FAILED";
        return;
      }
      if (!result.ok) throw new Error("feedback_close_failed");
      button.textContent = "DONE ✓";
      await refreshFeedbackEnvironment(item);
    } catch {
      button.disabled = false;
      button.textContent = "RETRY MARK DONE";
    }
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

  function environmentName(stage) {
    return {
      development: "Development",
      staging: "Staging",
      production: "Production",
    }[stage.key] || stage.label;
  }

  function compareStableVersions(left, right) {
    const a = String(left || "0.0.0").split(".").map(Number);
    const b = String(right || "0.0.0").split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function buildWorkRequest(operation, source, target, requestedVersion) {
    const targetName = environmentName(target);
    let action;
    if (operation === "promote") {
      action = "Promote ChessRiot v" + source.version + " from "
        + environmentName(source) + " to " + targetName + ".";
    } else if (
      target.version
      && compareStableVersions(requestedVersion, target.version) < 0
    ) {
      action = "Roll back ChessRiot " + targetName + " from v"
        + target.version + " to v" + requestedVersion + ".";
    } else if (
      target.version
      && compareStableVersions(requestedVersion, target.version) > 0
    ) {
      action = "Upgrade ChessRiot " + targetName + " from v"
        + target.version + " to v" + requestedVersion + ".";
    } else {
      action = "Deploy ChessRiot v" + requestedVersion + " to " + targetName + ".";
    }
    return action + "\nExecute and verify the deployment.";
  }

  function openPromotionHandoff(source, target) {
    pendingSwitchStage = null;
    handoffTitle.textContent = "Prepare " + environmentName(source) + " → " + environmentName(target);
    handoffFields.hidden = true;
    handoffCommand.textContent = buildWorkRequest("promote", source, target, null);
    handoffCopy.disabled = false;
    handoffCopy.textContent = "COPY WORK REQUEST";
    handoffDialog.showModal();
  }

  function openSwitchHandoff(stage) {
    pendingSwitchStage = stage;
    handoffTitle.textContent = "Switch " + environmentName(stage) + " version";
    handoffFields.hidden = false;
    handoffVersion.value = "";
    handoffCommand.textContent = "Enter a stable ChessRiot release above. ChatGPT Work will verify its immutable identity and database compatibility before deployment.";
    handoffCopy.disabled = true;
    handoffCopy.textContent = "COPY WORK REQUEST";
    handoffDialog.showModal();
    handoffVersion.focus();
  }

  function prepareSwitchHandoff() {
    const requestedVersion = handoffVersion.value.trim().replace(/^v/i, "");
    if (!pendingSwitchStage || !/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
      handoffCommand.textContent = "Enter a stable release in x.y.z format.";
      handoffCopy.disabled = true;
      return;
    }
    handoffCommand.textContent = buildWorkRequest(
      "switch",
      null,
      pendingSwitchStage,
      requestedVersion,
    );
    handoffCopy.disabled = false;
  }

  async function copyWorkRequest() {
    const text = handoffCommand.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    handoffCopy.textContent = "COPIED";
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
    const stages = [
      {
        key: "development",
        label: "DEV · AUTO LATEST",
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
        label: "PROD",
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
        action.className = "pipeline-action";
        const blocker = document.createElement("span");
        blocker.className = "pipeline-blocker";
        action.classList.add("promote");
        action.dataset.promotion = source.key + "-to-" + stage.key;
        if (!source.version || !stage.version) {
          action.disabled = true;
          action.textContent = "PREPARE PROMOTE";
          blocker.textContent = "checking versions";
          action.title = "Waiting for fresh environment checks.";
          action.setAttribute("aria-label", "Promotion disabled while current versions are being checked");
        } else if (source.version === stage.version) {
          action.textContent = "VERIFY / SYNC v" + source.version;
          blocker.textContent = "ChatGPT Work handoff";
          action.title = "Prepare a ChatGPT Work request that verifies immutable build identity and synchronizes only if needed.";
          action.setAttribute(
            "aria-label",
            source.label + " and " + stage.label + " both report version " + stage.version +
              "; prepare a ChatGPT Work request to verify or synchronize the exact build",
          );
          action.addEventListener("click", function () {
            openPromotionHandoff(source, stage);
          });
        } else {
          action.textContent = "PREPARE PROMOTE v" + source.version;
          blocker.textContent = "ChatGPT Work handoff";
          action.title = "Prepare a manual ChatGPT Work request. Control will not deploy anything.";
          action.setAttribute(
            "aria-label",
            "Prepare a ChatGPT Work request to promote version " + source.version + " from " +
              source.label + " to " + stage.label,
          );
          action.addEventListener("click", function () {
            openPromotionHandoff(source, stage);
          });
        }
        connector.append(arrow, action, blocker);
        pipeline.append(connector);
      }
      const node = document.createElement("article");
      node.className = "pipeline-node " + stage.key;
      const label = document.createElement("span");
      label.className = "pipeline-label";
      label.textContent = stage.label;
      const version = document.createElement("b");
      version.textContent = stage.version ? "v" + stage.version : "—";
      node.append(label, version);
      const nodeActions = document.createElement("div");
      nodeActions.className = "pipeline-node-actions";
      if (stage.url) {
        const open = document.createElement("a");
        open.className = "pipeline-open";
        open.href = stage.url;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.setAttribute("aria-label", "Open " + stage.label + " environment");
        open.textContent = "OPEN " + stage.label + " ↗";
        nodeActions.append(open);
      } else {
        const connecting = document.createElement("button");
        connecting.className = "pipeline-open";
        connecting.type = "button";
        connecting.disabled = true;
        connecting.textContent = "CONNECTING…";
        connecting.setAttribute("aria-label", stage.label + " environment link is loading");
        nodeActions.append(connecting);
      }
      const switchVersion = document.createElement("button");
      switchVersion.className = "pipeline-switch";
      switchVersion.type = "button";
      switchVersion.textContent = "SWITCH VERSION…";
      switchVersion.setAttribute(
        "aria-label",
        "Prepare a ChatGPT Work request to switch " + stage.label + " to a specific stable release",
      );
      switchVersion.addEventListener("click", function () {
        openSwitchHandoff(stage);
      });
      nodeActions.append(switchVersion);
      node.append(nodeActions);
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
    return normalizeFeedbackOverview(overview);
  }

  function feedbackTimestamp(entry) {
    return entry && (
      entry.createdAt ||
      entry.submittedAt ||
      entry.occurredAt ||
      entry.created_at
    );
  }

  function currentFeedbackSummary() {
    const states = [];
    for (const snapshot of snapshots.values()) {
      const feedback = snapshot.telemetryFresh
        ? feedbackData(snapshot.overview)
        : null;
      states.push({
        fresh: Boolean(feedback),
        exact: Boolean(feedback && feedback.exact),
        unresolved: feedback ? feedback.unresolved : 0,
      });
    }
    return summarizeFeedbackEnvironments(states);
  }

  function renderFeedbackLauncher() {
    const summary = currentFeedbackSummary();
    const quiet = summary.complete && summary.known === 0;
    feedbackBadge.hidden = quiet;
    feedbackBadge.textContent = summary.display;
    feedbackLauncher.dataset.state = quiet
      ? "quiet"
      : summary.known > 0 ? "attention" : "incomplete";
    feedbackLauncher.setAttribute(
      "aria-label",
      summary.complete
        ? (summary.known === 0
          ? "Feedback inbox, no unresolved items"
          : "Feedback inbox, " + summary.known + " unresolved items")
        : (summary.known
          ? "Feedback inbox, at least " + summary.known + " unresolved items; some environment counts are incomplete"
          : "Feedback inbox, unresolved count is incomplete"),
    );
    feedbackInboxSummary.textContent = summary.complete
      ? (summary.known === 0
        ? "All feedback is processed."
        : summary.known + (summary.known === 1 ? " unresolved item" : " unresolved items"))
      : (summary.known
        ? "At least " + summary.known + " unresolved; some environment counts are incomplete."
        : "Some environment counts are incomplete.");
  }

  function feedbackItem(entry, snapshot, exact) {
    const item = document.createElement("article");
    const status = entry && entry.status ? String(entry.status) : "new";
    item.className = "feedback-item";
    item.dataset.status = status;
    const top = document.createElement("div");
    top.className = "feedback-item-top";
    const title = document.createElement("strong");
    title.textContent = entry && entry.title ? String(entry.title) : "Untitled feedback";
    const environment = document.createElement("span");
    environment.className = "feedback-environment";
    environment.textContent = snapshot.item.name;
    top.append(title, environment);
    item.append(top);
    const comment = entry && (entry.comment || entry.details || entry.message);
    if (comment) {
      const body = document.createElement("p");
      body.textContent = String(comment);
      item.append(body);
    }
    const meta = document.createElement("span");
    meta.className = "feedback-meta";
    const timestamp = feedbackTimestamp(entry);
    const details = [];
    if (timestamp) details.push(new Date(timestamp).toLocaleString());
    if (entry && entry.appVersion) details.push("v" + String(entry.appVersion));
    if (entry && entry.page) details.push(String(entry.page));
    details.push(status);
    meta.textContent = details.join(" · ");
    item.append(meta);
    if (status !== "closed") {
      const done = document.createElement("button");
      done.className = "feedback-done";
      done.type = "button";
      done.textContent = exact ? "MARK DONE" : "MARK DONE UNAVAILABLE";
      done.disabled = !exact;
      done.addEventListener("click", function () {
        void markFeedbackDone(snapshot.item.key, String(entry.id || ""), done);
      });
      item.append(done);
    }
    return item;
  }

  function renderFeedbackInbox() {
    renderFeedbackLauncher();
    const summary = currentFeedbackSummary();
    const unresolved = [];
    const closed = [];
    const incomplete = [];
    for (const snapshot of snapshots.values()) {
      const feedback = snapshot.telemetryFresh
        ? feedbackData(snapshot.overview)
        : null;
      if (!feedback) {
        incomplete.push(snapshot.item ? snapshot.item.name : "Environment");
        continue;
      }
      if (!feedback.exact) {
        incomplete.push(snapshot.item ? snapshot.item.name : "Environment");
      }
      feedback.items.forEach(function (entry) {
        const target = entry && entry.status === "closed" ? closed : unresolved;
        target.push({ entry: entry, snapshot: snapshot, exact: feedback.exact });
      });
    }
    const newestFirst = function (left, right) {
      return String(feedbackTimestamp(right.entry) || "").localeCompare(
        String(feedbackTimestamp(left.entry) || ""),
      );
    };
    unresolved.sort(newestFirst);
    closed.sort(newestFirst);
    const content = document.createElement("div");
    if (incomplete.length) {
      const note = document.createElement("p");
      note.className = "feedback-environment-note";
      note.textContent = "Exact counts unavailable for: " + incomplete.join(", ") + ".";
      content.append(note);
    }
    if (unresolved.length) {
      const list = document.createElement("div");
      list.className = "feedback-list";
      unresolved.forEach(function (record) {
        list.append(feedbackItem(record.entry, record.snapshot, record.exact));
      });
      content.append(list);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = summary.complete
        ? "All caught up. No unresolved feedback."
        : "No unresolved feedback is visible; counts are incomplete.";
      content.append(empty);
    }
    feedbackUnresolved.replaceChildren(content);
    feedbackCompleted.hidden = closed.length === 0;
    feedbackCompletedSummary.textContent = "Completed (" + closed.length + ")";
    feedbackCompletedList.replaceChildren(...closed.map(function (record) {
      return feedbackItem(record.entry, record.snapshot, record.exact);
    }));
  }

  function renderEvents() {
    renderFeedbackInbox();
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
  feedbackLauncher.addEventListener("click", function () {
    feedbackInbox.showModal();
    feedbackLauncher.setAttribute("aria-expanded", "true");
  });
  document.querySelector("#feedback-inbox-close").addEventListener("click", function () {
    feedbackInbox.close();
  });
  feedbackInbox.addEventListener("close", function () {
    feedbackLauncher.setAttribute("aria-expanded", "false");
  });
  feedbackInbox.addEventListener("click", function (event) {
    if (event.target === feedbackInbox) feedbackInbox.close();
  });
  handoffCopy.disabled = true;
  document.querySelector("#handoff-cancel").addEventListener("click", function () {
    handoffDialog.close();
  });
  handoffDialog.addEventListener("click", function (event) {
    if (event.target === handoffDialog) handoffDialog.close();
  });
  handoffGenerate.addEventListener("click", prepareSwitchHandoff);
  handoffVersion.addEventListener("keydown", function (event) {
    if (event.key === "Enter") prepareSwitchHandoff();
  });
  handoffCopy.addEventListener("click", function () {
    void copyWorkRequest();
  });
  demoButton.addEventListener("click", function () {
    void regenerateDemoVideo();
  });
  void refreshDemoStatus();
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
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self' https://chessriot.ripper234.chatgpt.site https://chessriot-staging.ripper234.chatgpt.site https://chessriot-dev.ripper234.chatgpt.site; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
    if (request.method === "POST" && url.pathname === "/api/demo-video/narration") {
      return demoNarrationResponse(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/demo-video/publish") {
      return demoPublishResponse(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/demo-video/fail") {
      return demoFailResponse(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/demo-video/status") {
      return demoStatusResponse(env);
    }
    if (
      request.method === "GET"
      && url.pathname.startsWith("/api/demo-video/assets/")
    ) {
      return demoAssetResponse(
        url.pathname.slice("/api/demo-video/assets/".length),
        env,
      );
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
