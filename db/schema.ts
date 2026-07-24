import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
