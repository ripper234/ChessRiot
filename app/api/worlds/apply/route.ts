import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { appEnvironment } from "@/lib/runtime";
import {
  applyMagicWorld,
  magicPromptNeedsCompilation,
  pendingMagicWorldApplyMatches,
  pendingMagicWorldReservation,
  replayMagicWorldApply,
  type ApplyMagicWorldResult,
} from "@/lib/magic-worlds";
import {
  accountFeatureEnabled,
  MAGIC_RULES_FEATURE,
} from "@/lib/social";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const MAGIC_COMPILE_ACCOUNT_HOURLY_LIMIT = 5;
export const MAGIC_COMPILE_ACCOUNT_DAILY_LIMIT = 10;
export const MAGIC_COMPILE_GLOBAL_HOURLY_LIMIT = 25;
export const MAGIC_COMPILE_GLOBAL_DAILY_LIMIT = 100;

async function enforceCompilerBudget(accountId: string) {
  const checks: Array<[string, string, number, number]> = [
    [accountId, "magic_compile_hour", MAGIC_COMPILE_ACCOUNT_HOURLY_LIMIT, 60 * 60],
    [accountId, "magic_compile_day", MAGIC_COMPILE_ACCOUNT_DAILY_LIMIT, 24 * 60 * 60],
    [
      `system:${appEnvironment()}`,
      "magic_compile_global_hour",
      MAGIC_COMPILE_GLOBAL_HOURLY_LIMIT,
      60 * 60,
    ],
    [
      `system:${appEnvironment()}`,
      "magic_compile_global_day",
      MAGIC_COMPILE_GLOBAL_DAILY_LIMIT,
      24 * 60 * 60,
    ],
  ];
  for (const [subject, scope, limit, windowSeconds] of checks) {
    const result = await enforceAccountRateLimit(subject, scope, limit, windowSeconds);
    if (!result.allowed) return result;
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  if (!(await accountFeatureEnabled(account.id, MAGIC_RULES_FEATURE))) {
    return apiError(403, "magic_rules_unavailable", "Magic Rules access is required");
  }
  return json({ reservation: await pendingMagicWorldReservation(account.id) });
}

function applyResponse(result: ApplyMagicWorldResult): Response {
  if (!result.ok) {
    const compilationCode = result.code === "compile_failed"
      ? result.compilation?.code ?? "compile_failed"
      : result.code;
    const status = result.code === "insufficient_credits"
      ? 402
      : result.code === "not_found"
        ? 404
        : result.code === "idempotency_conflict"
            || result.code === "lineage_conflict"
            || result.code === "in_progress"
          ? 409
          : result.code === "compile_failed"
            ? result.compilation?.code === "unsupported"
                || result.compilation?.code === "ambiguous"
                || result.compilation?.code === "invalid_prompt"
              ? 422
              : result.compilation?.code === "provider_timeout"
                ? 504
                : result.compilation?.code === "invalid_provider_response"
                    || result.compilation?.code === "provider_rejected"
                  ? 502
                  : 503
            : 400;
    return apiError(status, compilationCode, result.message);
  }
  return json(result, { status: result.created ? 201 : 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  if (!(await accountFeatureEnabled(account.id, MAGIC_RULES_FEATURE))) {
    return apiError(403, "magic_rules_unavailable", "Magic Rules access is required");
  }
  const body = await readJson(request);
  if (!body || !isUuid(body.requestId)) {
    return apiError(400, "invalid_request", "A valid game request id is required");
  }
  const applyInput = {
    accountId: account.id,
    gameCreateRequestId: body.requestId,
    prompt: body.prompt,
    worldCode: body.worldCode,
    parentCode: body.parentCode,
  };
  const replay = await replayMagicWorldApply(applyInput);
  if (replay) return applyResponse(replay);
  const pendingRetry = await pendingMagicWorldApplyMatches(applyInput);
  if (!pendingRetry) {
    const rate = await enforceAccountRateLimit(account.id, "magic_apply", 20, 60 * 60);
    if (!rate.allowed) {
      return json(
        { error: { code: "rate_limited", message: "Too many Magic requests. Try again later." } },
        { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
      );
    }
    if (
      typeof body.prompt === "string"
      && body.prompt.trim()
      && await magicPromptNeedsCompilation(body.prompt)
    ) {
      const blocked = await enforceCompilerBudget(account.id);
      if (blocked) {
        return json(
          { error: { code: "compile_budget_reached", message: "New Magic compilation is temporarily capped. Play an existing World or try later. No credit was charged." } },
          { status: 429, headers: { "retry-after": String(blocked.retryAfter) } },
        );
      }
    }
  }
  return applyResponse(await applyMagicWorld(applyInput));
}
