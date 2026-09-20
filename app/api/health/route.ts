import { getDatabase, runtimeInvariantStatus } from "@/db";
import { publicPushConfig } from "@/lib/push-notifications";
import { appEnvironment, controlOrigin, runtimeReadiness } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let database = "ok";
  let storageEpoch: string | null = null;
  try {
    storageEpoch = (await runtimeInvariantStatus()).storageEpoch;
    const requiredTables = [
      "accounts",
      "account_blocks",
      "account_credit_ledger",
      "account_feature_flags",
      "account_notifications",
      "account_tombstones",
      "feature_access_requests",
      "game_memberships",
      "game_settings",
      "games",
      "magic_rule_compilations",
      "magic_rule_rejections",
      "magic_world_derivations",
      "magic_world_entitlements",
      "magic_world_sources",
      "magic_world_uses",
      "magic_worlds",
      "moves",
      "rate_limit_windows",
      "public_rate_limit_windows",
      "push_account_deliveries",
      "push_deliveries",
      "push_devices",
      "push_subscriptions",
      "push_turn_deliveries",
      "ops_action_nonces",
      "safety_report_archive",
      "safety_reports",
      "runtime_invariants",
    ];
    const result = await getDatabase()
      .prepare(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})`)
      .bind(...requiredTables)
      .all<{ name: string }>();
    const found = new Set(result.results.map((row) => row.name));
    if (!requiredTables.every((table) => found.has(table))) database = "error";
    const [accountColumns, observabilityColumns] = await Promise.all([
      getDatabase().prepare("PRAGMA table_info(accounts)").all<{ name: string }>(),
      getDatabase().prepare("PRAGMA table_info(observability_events)").all<{ name: string }>(),
    ]);
    if (
      !accountColumns.results.some((column) => column.name === "tutorial_status")
      || !observabilityColumns.results.some((column) => column.name === "actor_hash")
    ) database = "error";
  } catch {
    database = "error";
  }
  const readiness = runtimeReadiness();
  const push = await publicPushConfig();
  const healthy = database === "ok" && readiness.core;
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (origin === controlOrigin()) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  } else {
    headers.set("access-control-allow-origin", "*");
  }
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      environment: appEnvironment(),
      version: APP_VERSION,
      database,
      configuration: readiness.configuration,
      capabilities: { ...readiness.capabilities, push: push.enabled },
      continuity: {
        storageEpoch,
        accountIdentity: storageEpoch !== null,
      },
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers,
    },
  );
}
