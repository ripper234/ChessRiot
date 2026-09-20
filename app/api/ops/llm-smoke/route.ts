import { authorizeLlmSmoke, opsCorsHeaders } from "@/lib/ops-auth";
import { runOpenAiSmoke } from "@/lib/openai-smoke";
import { appEnvironment, openAiApiKey } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";
import { ensureSchema, getDatabase } from "@/db";

export const dynamic = "force-dynamic";

const NEVER_EXPIRES_SECONDS = 253_402_300_799;

async function reserveReleaseSmokeAttempt(): Promise<boolean> {
  await ensureSchema();
  const environment = appEnvironment();
  const key = `ops:llm-smoke:${environment}:${APP_VERSION}`;
  const result = await getDatabase()
    .prepare(`INSERT OR IGNORE INTO rate_limit_windows (
      key, account_id, scope, window_start, hit_count, expires_at
    ) VALUES (?, ?, 'llm_smoke_release', 0, 1, ?) `)
    .bind(key, `ops:${environment}`, NEVER_EXPIRES_SECONDS)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function POST(request: Request): Promise<Response> {
  const headers = opsCorsHeaders(request.headers.get("origin"));
  headers.set("content-type", "application/json; charset=utf-8");
  if (!(await authorizeLlmSmoke(request))) {
    return new Response(JSON.stringify({ error: "not_authorized" }), {
      status: 403,
      headers,
    });
  }
  if (!openAiApiKey()) {
    return new Response(JSON.stringify({ error: "missing_key" }), {
      status: 503,
      headers,
    });
  }
  if (!(await reserveReleaseSmokeAttempt())) {
    return new Response(JSON.stringify({ error: "already_attempted" }), {
      status: 409,
      headers,
    });
  }
  const result = await runOpenAiSmoke();
  return new Response(JSON.stringify({
    environment: appEnvironment(),
    ...result,
  }), {
    status: result.ok ? 200 : result.status,
    headers,
  });
}
