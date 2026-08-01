import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

const env = {
  DEV_URL: "https://chessriot-dev.example",
  DEV_SITES_BYPASS_TOKEN: "dev-edge-token",
  VIDEO_REGEN_ALLOWED_EMAIL: "owner@example.com",
  VIDEO_REGEN_SHARED_SECRET: "shared-video-secret",
};

function ownerHeaders(values = {}) {
  return {
    origin: "https://control.example",
    "oai-authenticated-user-email": "owner@example.com",
    "sec-fetch-site": "same-origin",
    ...values,
  };
}

test("renders the owner-facing video control without exposing secrets", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/"),
    env,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Demo video/);
  assert.match(html, /Story-first 90-second explainer/);
  assert.match(html, /Ron and Omri carry one game through a real day/);
  assert.match(html, /REGENERATE 90-SEC VIDEO/);
  assert.match(html, /Direct deployment is not connected/);
  assert.match(html, /<dialog id="release-handoff"/);
  assert.match(html, /COPY WORK REQUEST/);
  assert.match(html, /https:\/\/chessriot\.gg\/changelog/);
  assert.match(html, /https:\/\/dev\.chessriot\.gg\/demo/);
  assert.doesNotMatch(html, /ripper234\.chatgpt\.site/);
  assert.doesNotMatch(html, /dev-edge-token|shared-video-secret/);
});

test("offers a truthful Work handoff without exposing a fake deploy route", async () => {
  const scriptResponse = await worker.fetch(
    new Request("https://control.example/control.js"),
    env,
  );
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();
  assert.match(script, /PREPARE PROMOTE v/);
  assert.match(script, /SWITCH VERSION…/);
  assert.match(script, /Promote ChessRiot v/);
  assert.match(script, /Roll back ChessRiot/);
  assert.match(script, /Upgrade ChessRiot/);
  assert.match(
    script,
    /return action \+ "\\nExecute and verify the deployment\."/,
  );
  assert.doesNotMatch(script, /Requirements:|Do not rely on SemVer alone/);
  assert.match(script, /navigator\.clipboard/);
  assert.doesNotMatch(script, /fetch\([^)]*\/api\/(?:promote|deploy)/);

  const deployResponse = await worker.fetch(
    new Request("https://control.example/api/promote", {
      method: "POST",
      body: "{}",
    }),
    env,
  );
  assert.equal(deployResponse.status, 404);
});

test("rejects narration requests without the exact owner identity", async () => {
  const response = await worker.fetch(
    new Request("https://control.example/api/demo-video/narration", {
      method: "POST",
      headers: {
        origin: "https://control.example",
        "sec-fetch-site": "same-origin",
      },
    }),
    env,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "not_authorized" });
});

test("keeps the Dev edge token server-side on status reads", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = null;
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers)
      .get("OAI-Sites-Authorization");
    return Response.json({
      source: "bundled",
      durationSeconds: 90,
      generatedAt: null,
      mimeType: "video/mp4",
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://control.example/api/demo-video/status", {
        headers: ownerHeaders(),
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer dev-edge-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("binds narration generation to the current story recipe", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded = null;
  globalThis.fetch = async (_url, init) => {
    forwarded = new Headers(init?.headers);
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": "audio/mpeg",
        "x-demo-video-story-version": "2",
      },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://control.example/api/demo-video/narration", {
        method: "POST",
        headers: ownerHeaders(),
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(forwarded.get("x-demo-video-story-version"), "2");
    assert.equal(response.headers.get("x-demo-video-story-version"), "2");
    assert.ok(forwarded.get("x-demo-video-signature"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not turn a malformed upstream publish into green success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: "publish_failed", storyVersion: 2 },
    { status: 200 },
  );
  const body = new Uint8Array(100_000);
  try {
    const response = await worker.fetch(
      new Request("https://control.example/api/demo-video/publish", {
        method: "POST",
        headers: ownerHeaders({
          "content-type": "video/webm;codecs=vp9,opus",
          "x-demo-video-bytes": String(body.byteLength),
          "x-demo-video-duration": "90",
          "x-demo-video-job": "11111111-1111-4111-8111-111111111111",
          "x-demo-video-sha256": "A".repeat(43),
          "x-demo-video-story-version": "2",
        }),
        body,
      }),
      env,
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "publish_failed" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
