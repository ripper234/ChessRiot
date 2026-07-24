import { getDatabase } from "@/db";
import { appEnvironment } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = "ok";
  try {
    await getDatabase().prepare("SELECT 1").first();
  } catch {
    database = "error";
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
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
