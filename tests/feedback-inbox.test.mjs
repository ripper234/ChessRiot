import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  normalizeFeedbackOverview,
  summarizeFeedbackEnvironments,
} from "../worker/index.js";

const environment = {
  DEV_URL: "https://chessriot-dev.ripper234.chatgpt.site",
  STAGING_URL: "https://chessriot-staging.ripper234.chatgpt.site",
  PROD_URL: "https://chessriot.ripper234.chatgpt.site",
  DEV_OPS_READ_SECRET: "dev-feedback-test-secret",
  STAGING_OPS_READ_SECRET: "staging-feedback-test-secret",
  PROD_OPS_READ_SECRET: "prod-feedback-test-secret",
};

function grantPayload(grant) {
  return JSON.parse(Buffer.from(grant.split(".", 1)[0], "base64url").toString("utf8"));
}

test("summarizes exact, quiet, and partially available feedback counts", () => {
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 3 },
    { fresh: true, exact: true, unresolved: 2 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 5, complete: true, display: "5" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 0 },
    { fresh: true, exact: true, unresolved: 0 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 0, complete: true, display: "0" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: true, unresolved: 2 },
    { fresh: false, exact: false, unresolved: 0 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 2, complete: false, display: "2+" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: false, exact: false, unresolved: 0 },
    { fresh: false, exact: false, unresolved: 0 },
    { fresh: false, exact: false, unresolved: 0 },
  ]), { known: 0, complete: false, display: "?" });
  assert.deepEqual(summarizeFeedbackEnvironments([
    { fresh: true, exact: false, unresolved: 1 },
    { fresh: true, exact: true, unresolved: 0 },
    { fresh: true, exact: true, unresolved: 0 },
  ]), { known: 1, complete: false, display: "1+" });
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

test("mints separate short-lived read and feedback grants", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/api/status"),
    environment,
  );
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.controlVersion, "0.5.0");
  assert.equal(status.environments.length, 3);
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
    /dev-feedback-test-secret|staging-feedback-test-secret|prod-feedback-test-secret/,
  );
});

test("renders a compact top-right launcher and right-side inbox", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/"),
    environment,
  );
  const html = await response.text();
  assert.match(html, /id="feedback-launcher"/);
  assert.match(html, /aria-controls="feedback-inbox"/);
  assert.match(html, /id="feedback-badge"/);
  assert.match(html, /<dialog class="feedback-inbox-dialog" id="feedback-inbox"/);
  assert.match(html, /id="feedback-unresolved"/);
  assert.match(html, /id="feedback-completed"/);
  assert.doesNotMatch(html, /id="feedback-count"|<details class="drawer feedback"/);
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
  assert.match(script, /summary\.complete && summary\.known === 0/);
  assert.match(script, /String\(known\) \+ "\+"/);
  assert.match(script, /counts\.unresolved >= listedUnresolved/);
  assert.match(script, /if \(!feedback\.exact\)/);
  assert.match(script, /empty\.textContent = summary\.complete/);
});
