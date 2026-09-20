import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import {
  isSafetyReportCategory,
  normalizeSafetyNote,
  reportPlayer,
} from "@/lib/safety";
import { blockPlayer } from "@/lib/social";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const rate = await enforceAccountRateLimit(account.id, "player_report", 10, 24 * 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many reports. Try later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  const note = normalizeSafetyNote(body?.note);
  if (
    !body
    || typeof body.username !== "string"
    || !isSafetyReportCategory(body.category)
    || note === undefined
    || (body.block !== undefined && typeof body.block !== "boolean")
  ) {
    return apiError(400, "invalid_report", "Choose a category and keep notes under 280 characters");
  }
  const result = await reportPlayer({
    reporterAccountId: account.id,
    targetUsername: body.username,
    category: body.category,
    note,
  });
  if (!result.ok) return apiError(422, "report_unavailable", result.message);
  const blockResult = body.block === true
    ? await blockPlayer(account.id, body.username)
    : null;
  return json({
    reportId: result.reportId,
    blocked: blockResult?.ok === true,
    blockError: blockResult && !blockResult.ok ? blockResult.message : null,
  }, { status: 201 });
}
