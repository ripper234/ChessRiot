import { getDatabase } from "@/db";
import { appEnvironment, controlOrigin, runtimeReadiness } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let database = "ok";
  try {
    const requiredTables = [
      "accounts",
      "game_memberships",
      "game_settings",
      "games",
      "moves",
      "rate_limit_windows",
    ];
    const result = await getDatabase()
      .prepare(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(",")})`)
      .bind(...requiredTables)
      .all<{ name: string }>();
    const found = new Set(result.results.map((row) => row.name));
    if (!requiredTables.every((table) => found.has(table))) database = "error";
  } catch {
    database = "error";
  }
  const readiness = runtimeReadiness();
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
      capabilities: readiness.capabilities,
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers,
    },
  );
}
