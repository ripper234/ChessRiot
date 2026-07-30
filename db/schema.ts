import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const deploymentRegistry = sqliteTable("deployment_registry", {
  environment: text("environment").primaryKey().notNull(),
  deployedVersion: text("deployed_version").notNull(),
  deployedAt: text("deployed_at"),
  verifiedAt: text("verified_at"),
  runtimeVersion: text("runtime_version"),
  healthState: text("health_state").notNull().default("unknown"),
  healthStatus: text("health_status"),
  databaseStatus: text("database_status"),
  lastHealthAt: text("last_health_at"),
  lastCheckedAt: text("last_checked_at"),
  updatedAt: text("updated_at").notNull(),
});

export const aiUsageEvents = sqliteTable("ai_usage_events", {
  id: text("id").primaryKey().notNull(),
  occurredAt: text("occurred_at").notNull(),
  scope: text("scope").notNull(),
  version: text("version"),
  environment: text("environment"),
  model: text("model"),
  purpose: text("purpose").notNull(),
  outcome: text("outcome"),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  avoidableTokens: integer("avoidable_tokens"),
  costUsdMicros: integer("cost_usd_micros"),
  avoidableCostUsdMicros: integer("avoidable_cost_usd_micros"),
  wasteRule: text("waste_rule"),
  source: text("source").notNull(),
  sourceEventId: text("source_event_id").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("ai_usage_events_source_event_unique")
    .on(table.source, table.sourceEventId),
  index("ai_usage_events_occurred_at_idx").on(table.occurredAt),
  index("ai_usage_events_version_idx").on(table.version),
]);
