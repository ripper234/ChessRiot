import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  normalizeAiUsageEvent,
  summarizeAiUsage,
} from "../worker/index.js";

function ownerRequest(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: {
      "oai-authenticated-user-email": "owner@example.com",
      ...options.headers,
    },
  });
}

function usageRow(overrides = {}) {
  return {
    occurred_at: "2026-07-29T08:00:00.000Z",
    scope: "development",
    version: "0.13.5",
    environment: null,
    model: "gpt-test",
    purpose: "build",
    outcome: "success",
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 20,
    reasoning_tokens: 10,
    avoidable_tokens: null,
    cost_usd_micros: null,
    avoidable_cost_usd_micros: null,
    waste_rule: null,
    source: "test",
    source_event_id: crypto.randomUUID(),
    request_count: 1,
    ...overrides,
  };
}

test("normalizes exact token details without allowing double-counting", () => {
  const valid = normalizeAiUsageEvent({
    occurredAt: new Date().toISOString(),
    scope: "runtime",
    version: "0.11.0-magic.4",
    environment: "preview",
    model: "gpt-test",
    purpose: "magic_rules",
    outcome: "success",
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 25,
    reasoningTokens: 10,
    avoidableTokens: 125,
    wasteRule: "duplicate_compilation",
    source: "magic_preview",
    sourceEventId: "compile-1",
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.event.inputTokens + valid.event.outputTokens, 125);
  assert.equal(valid.event.cachedInputTokens, 40);
  assert.equal(valid.event.reasoningTokens, 10);

  assert.deepEqual(normalizeAiUsageEvent({
    ...valid.event,
    occurredAt: new Date().toISOString(),
    cachedInputTokens: 101,
  }), { ok: false, error: "inconsistent_counts" });
  assert.deepEqual(normalizeAiUsageEvent({
    ...valid.event,
    occurredAt: new Date().toISOString(),
    wasteRule: null,
  }), { ok: false, error: "invalid_waste_classification" });
});

test("summarizes development first, runtime separately, and leaves unknown waste unclassified", () => {
  const summary = summarizeAiUsage([
    usageRow(),
    usageRow({
      occurred_at: "2026-07-29T09:00:00.000Z",
      input_tokens: 50,
      cached_input_tokens: 0,
      output_tokens: 10,
      reasoning_tokens: 0,
      avoidable_tokens: 60,
      waste_rule: "failed_no_artifact",
      cost_usd_micros: 2000,
      avoidable_cost_usd_micros: 2000,
    }),
    usageRow({
      occurred_at: "2026-07-29T10:00:00.000Z",
      scope: "runtime",
      purpose: "magic_rules",
      input_tokens: 20,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_tokens: 0,
      avoidable_tokens: 25,
      waste_rule: "duplicate_compilation",
      cost_usd_micros: 500,
      avoidable_cost_usd_micros: 500,
    }),
  ]);
  assert.equal(summary.scopes.development.trackedTokens, 180);
  assert.equal(summary.scopes.development.avoidableTokens, 60);
  assert.equal(summary.scopes.development.unclassifiedTokens, 120);
  assert.equal(summary.scopes.runtime.trackedTokens, 25);
  assert.equal(summary.total.trackedTokens, 205);
  assert.equal(summary.total.avoidableTokens, 85);
  assert.equal(summary.runtimeCauses[0].cause, "duplicate_compilation");
  assert.equal(summary.byVersion[0].version, "0.13.5");
});

class FakeUsageStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new FakeUsageStatement(this.database, this.sql, bindings);
  }

  async run() {
    if (/CREATE TABLE IF NOT EXISTS ai_usage_events|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/.test(this.sql)) {
      return { success: true, meta: { changes: 0 } };
    }
    if (/INSERT OR IGNORE INTO ai_usage_events/.test(this.sql)) {
      const [
        id,
        occurred_at,
        scope,
        version,
        environment,
        model,
        purpose,
        outcome,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
        avoidable_tokens,
        cost_usd_micros,
        avoidable_cost_usd_micros,
        waste_rule,
        source,
        source_event_id,
        request_count,
        schema_version,
        created_at,
      ] = this.bindings;
      const duplicate = this.database.rows.some((row) =>
        row.source === source && row.source_event_id === source_event_id);
      if (!duplicate) {
        this.database.rows.push({
          id,
          occurred_at,
          scope,
          version,
          environment,
          model,
          purpose,
          outcome,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_tokens,
          avoidable_tokens,
          cost_usd_micros,
          avoidable_cost_usd_micros,
          waste_rule,
          source,
          source_event_id,
          request_count,
          schema_version,
          created_at,
        });
      }
      return { success: true, meta: { changes: duplicate ? 0 : 1 } };
    }
    throw new Error(`Unsupported run: ${this.sql}`);
  }

  async all() {
    if (/GROUP BY scope/.test(this.sql)) {
      const groups = new Map();
      for (const row of this.database.rows) {
        const current = groups.get(row.scope) ?? {
          scope: row.scope,
          records: 0,
          last_at: null,
        };
        current.records += 1;
        if (!current.last_at || row.occurred_at > current.last_at) {
          current.last_at = row.occurred_at;
        }
        groups.set(row.scope, current);
      }
      return { results: [...groups.values()] };
    }
    if (/SELECT \* FROM ai_usage_events/.test(this.sql)) {
      const since = /WHERE occurred_at >=/.test(this.sql) ? this.bindings[0] : null;
      const limit = this.bindings.at(-1);
      return {
        results: this.database.rows
          .filter((row) => !since || row.occurred_at >= since)
          .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
          .slice(0, limit),
      };
    }
    throw new Error(`Unsupported all: ${this.sql}`);
  }
}

class FakeUsageD1 {
  constructor() {
    this.rows = [];
  }

  prepare(sql) {
    return new FakeUsageStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

test("renders the dashboard and serves an idempotent usage ledger", async () => {
  const page = await worker.fetch(new Request("https://control.test/"), {});
  const html = await page.text();
  const developmentIndex = html.indexOf("Development / build waste");
  const runtimeIndex = html.indexOf("Runtime waste");
  assert.match(html, /id="financial-dashboard"/);
  assert.match(html, /AI cost &amp; waste/);
  assert.ok(developmentIndex >= 0 && runtimeIndex > developmentIndex);
  assert.match(html, /Not tracked yet/);
  assert.match(html, /Stable gameplay expects zero LLM calls per move/);

  const database = new FakeUsageD1();
  const environment = {
    DB: database,
    FINANCIALS_INGEST_SECRET: "financial-test-secret",
    CONTROL_OWNER_EMAIL: "owner@example.com",
  };
  const event = {
    occurredAt: new Date().toISOString(),
    scope: "development",
    version: "0.13.5",
    model: "gpt-test",
    purpose: "build",
    outcome: "success",
    inputTokens: 200,
    cachedInputTokens: 50,
    outputTokens: 40,
    reasoningTokens: 10,
    avoidableTokens: 240,
    wasteRule: "failed_no_artifact",
    source: "codex",
    sourceEventId: "run-1",
  };
  const ingest = () => worker.fetch(
    new Request("https://control.test/api/financials/events", {
      method: "POST",
      headers: {
        authorization: "Bearer financial-test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    }),
    environment,
  );
  assert.equal((await ingest()).status, 202);
  const duplicate = await ingest();
  assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).stored, 0);
  assert.equal(database.rows.length, 1);

  const dashboard = await worker.fetch(
    ownerRequest("https://control.test/api/financials?window=30"),
    environment,
  );
  assert.equal(dashboard.status, 200);
  const payload = await dashboard.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.instrumentation.development.connected, true);
  assert.equal(payload.instrumentation.runtime.connected, false);
  assert.equal(payload.summary.scopes.development.trackedTokens, 240);
  assert.equal(payload.summary.scopes.development.avoidableTokens, 240);
  assert.equal(payload.expectations.stableGameplay.expectedLlmCallsPerMove, 0);
  assert.equal(payload.expectations.runtimeAi.expectedLlmCallsPerMove, 0);
});

test("rejects unauthorized ingestion and invalid windows", async () => {
  const unauthorized = await worker.fetch(
    new Request("https://control.test/api/financials/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    { FINANCIALS_INGEST_SECRET: "secret" },
  );
  assert.equal(unauthorized.status, 403);

  const invalidWindow = await worker.fetch(
    ownerRequest("https://control.test/api/financials?window=365"),
    { CONTROL_OWNER_EMAIL: "owner@example.com" },
  );
  assert.equal(invalidWindow.status, 400);
});
