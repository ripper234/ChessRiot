import {
  enforceAccountRateLimit,
  requireGoogleApiAccount,
} from "@/lib/accounts";
import {
  getFeatureAccessState,
  isRequestableFeatureKey,
  requestFeatureAccess,
} from "@/lib/feature-access";
import { apiError, json, readJson } from "@/lib/http";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");

  const body = await readJson(request);
  if (!body || !isRequestableFeatureKey(body.feature)) {
    return apiError(400, "feature_not_requestable", "That feature is not accepting requests");
  }
  const existing = await getFeatureAccessState(account.id, body.feature);
  if (existing.status !== "none") return json(existing);

  const rate = await enforceAccountRateLimit(account.id, "feature_access_request", 5, 24 * 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many access requests. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const result = await requestFeatureAccess(account.id, body.feature);
  return json({
    feature: result.feature,
    status: result.status,
    requestedAt: result.requestedAt,
  }, { status: result.created ? 201 : 200 });
}
