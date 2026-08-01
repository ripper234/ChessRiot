import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import worker, {
  concreteUnresolvedFeedbackCount,
  normalizeFeedbackOverview,
  summarizeFeedbackEnvironments,
} from "../worker/index.js";

const expectedControlVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

const environment = {
  DEV_URL: "https://dev.chessriot.gg",
  PROD_URL: "https://chessriot.gg",
  DEV_OPS_READ_SECRET: "dev-feedback-test-secret-32-bytes-minimum",
  PROD_OPS_READ_SECRET: "prod-feedback-test-secret-32-bytes-minimum",
  CONTROL_OWNER_EMAIL: "owner@example.com",
};

function ownerRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: {
      "oai-authenticated-user-email": "owner@example.com",
      ...options.headers,
    },
  });
}

function grantPayload(grant) {
  return JSON.parse(Buffer.from(grant.split(".", 1)[0], "base64url").toString("utf8"));
}

test("summarizes exact, quiet, and partially available feedback counts", () => {
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 3 },
    { fresh: true, exact: true, unresolved: 2 },
  ]), { known: 5, complete: true, display: "5" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 0 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 0, complete: true, display: "0" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 2 },
    { fresh: false, exact: false, unresolved: 0 },
  ]), { known: 2, complete: false, display: "2+" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: false, exact: false, unresolved: 0 },
    { fresh: false, exact: false, unresolved: 0 },
  ]), { known: 0, complete: false, display: "?" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: false, unresolved: 1 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 1, complete: false, display: "1+" });
});

test("the browser-serialized feedback summary has no server-only globals", () => {
  const serialized = `(${summarizeFeedbackEnvironments.toString()})([
    { fresh: true, exact: true, unresolved: 1 },
    { fresh: true, exact: true, unresolved: 0 }
  ])`;
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInNewContext(serialized))),
    { known: 1, complete: true, display: "1" },
  );
});

test("never trusts an exact count below visible unresolved feedback", () => {
  assert.deepEqual(normalizeFeedbackOverview({
    feedback: [{ id: "legacy", status: "new" }],
  }), {
    items: [{ id: "legacy", status: "new" }],
    total: 1,
    unresolved: 1,
    exact: false,
  });
  assert.deepEqual(normalizeFeedbackOverview({
    feedbackPool: {
      items: [{ id: "race", status: "reviewed" }],
      total: 1,
      unresolved: 0,
    },
  }), {
    items: [{ id: "race", status: "reviewed" }],
    total: 1,
    unresolved: 1,
    exact: false,
  });
  assert.equal(normalizeFeedbackOverview({
    feedbackPool: {
      items: [{ id: "closed", status: "closed" }],
      total: 1,
      unresolved: 0,
    },
  }).exact, true);
});

test("red badge count comes only from concrete unresolved records", () => {
  assert.equal(concreteUnresolvedFeedbackCount([
    {
      feedbackPool: {
        items: [],
        total: 5,
        unresolved: 5,
      },
    },
  ]), 0);
  assert.equal(concreteUnresolvedFeedbackCount([
    {
      feedbackPool: {
        items: [
          { id: "open", status: "new" },
          { id: "done", status: "closed" },
        ],
        total: 2,
        unresolved: 1,
      },
    },
  ]), 1);
});

test("mints separate short-lived read and feedback grants", async () => {
  const response = await worker.fetch(
    ownerRequest("https://control.example/api/status"),
    environment,
  );
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.controlVersion, expectedControlVersion);
  assert.equal(status.environments.length, 2);
  for (const item of status.environments) {
    const read = grantPayload(item.grant);
    const manage = grantPayload(item.feedbackGrant);
    assert.equal(read.aud, item.key);
    assert.equal(manage.aud, item.key);
    assert.equal(read.scope, "observability:read");
    assert.equal(manage.scope, "feedback:manage");
    assert.equal(read.exp - read.iat, 120);
    assert.equal(manage.exp - manage.iat, 120);
    assert.notEqual(read.nonce, manage.nonce);
  }
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(
    serialized,
    /dev-feedback-test-secret|prod-feedback-test-secret/,
  );
});

test("protects status grants with the authenticated owner identity", async () => {
  const denied = await worker.fetch(
    new Request("https://control.example/api/status"),
    environment,
  );
  assert.equal(denied.status, 403);

  const weakConfiguration = {
    ...environment,
    DEV_URL: "http://dev.chessriot.gg/path",
    DEV_OPS_READ_SECRET: "too-short",
  };
  const response = await worker.fetch(
    ownerRequest("https://control.example/api/status"),
    weakConfiguration,
  );
  const status = await response.json();
  const development = status.environments.find((item) => item.key === "development");
  assert.equal(development.url, null);
  assert.equal(development.configured, false);
  assert.equal(development.grant, null);
  assert.equal(development.feedbackGrant, null);
});

test("rejects forged browser observations before touching persistence", async () => {
  const body = JSON.stringify({
    environment: "production",
    healthState: "fresh",
    runtimeVersion: "9.9.9",
  });
  const forged = await worker.fetch(
    new Request("https://control.example/api/registry/observation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-control-observation": "browser-health-v1",
      },
      body,
    }),
    environment,
  );
  assert.equal(forged.status, 403);

  const crossSite = await worker.fetch(
    ownerRequest("https://control.example/api/registry/observation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://control.example",
        "sec-fetch-site": "cross-site",
        "x-control-observation": "browser-health-v1",
      },
      body,
    }),
    environment,
  );
  assert.equal(crossSite.status, 403);

  const authorized = await worker.fetch(
    ownerRequest("https://control.example/api/registry/observation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://control.example",
        "sec-fetch-site": "same-origin",
        "x-control-observation": "browser-health-v1",
      },
      body,
    }),
    environment,
  );
  assert.equal(authorized.status, 503);
});

test("reports a read-only Control health check", async () => {
  const healthy = await worker.fetch(
    new Request("https://control.example/api/health"),
    {
      ...environment,
      DB: {
        prepare() {
          return { first: async () => ({ ok: 1 }) };
        },
      },
    },
  );
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), {
    status: "ok",
    version: expectedControlVersion,
    database: "ok",
    ownerConfigured: true,
    environments: {
      development: {
        urlConfigured: true,
        secretConfigured: true,
        configured: true,
      },
      production: {
        urlConfigured: true,
        secretConfigured: true,
        configured: true,
      },
    },
  });
});

test("renders a compact top-right launcher and right-side inbox", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/"),
    environment,
  );
  const html = await response.text();
  const csp = response.headers.get("content-security-policy");
  assert.match(html, /id="feedback-launcher"/);
  assert.match(html, /aria-controls="feedback-inbox"/);
  assert.match(html, /id="feedback-badge" hidden/);
  assert.match(html, /<dialog class="feedback-inbox-dialog" id="feedback-inbox"/);
  assert.match(html, /id="feedback-unresolved"/);
  assert.match(html, /id="feedback-completed"/);
  assert.doesNotMatch(html, /id="feedback-count"|<details class="drawer feedback"/);
  assert.match(html, /https:\/\/chessriot\.gg\/changelog/);
  assert.match(html, /https:\/\/dev\.chessriot\.gg\/demo/);
  assert.match(csp, /connect-src 'self' https:\/\/dev\.chessriot\.gg https:\/\/chessriot\.gg/);
  assert.doesNotMatch(csp, /ripper234\.chatgpt\.site/);
});

test("refreshes grants before closing feedback and preserves environment credentials", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/control.js"),
    environment,
  );
  const script = await response.text();
  const freshStatus = script.indexOf("fetchFreshStatusEnvironment(environmentKey)");
  const closeRoute = script.indexOf('"/api/ops/feedback/" + encodeURIComponent(feedbackId) + "/close"');
  assert.ok(freshStatus >= 0);
  assert.ok(closeRoute > freshStatus);
  assert.match(script, /body: item\.feedbackGrant/);
  assert.match(script, /item\.access === "Owner only" \? "include" : "omit"/);
  assert.match(script, /MARK DONE UNAVAILABLE/);
  assert.match(script, /AUTHORIZATION FAILED/);
  assert.match(script, /feedbackBadge\.hidden = concreteUnread === 0/);
  assert.match(script, /feedbackLauncher\.dataset\.state = concreteUnread > 0/);
  assert.match(script, /concreteUnresolvedFeedbackCount/);
  assert.match(script, /String\(known\) \+ "\+"/);
  assert.match(script, /counts\.unresolved >= listedUnresolved/);
  assert.match(script, /if \(!feedback\.exact\)/);
  assert.match(script, /empty\.textContent = summary\.complete/);
});
