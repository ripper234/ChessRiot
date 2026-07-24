import { getDatabase } from "@/db";
import { appEnvironment, controlOrigin } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let database = "ok";
  try {
    await getDatabase().prepare("SELECT 1").first();
  } catch {
    database = "error";
  }
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
      status: database === "ok" ? "ok" : "degraded",
      environment: appEnvironment(),
      version: APP_VERSION,
      database,
      checkedAt: new Date().toISOString(),
    },
    {
      status: database === "ok" ? 200 : 503,
      headers,
    },
  );
}
