import {
  enforceAccountRateLimit,
  requireGoogleApiAccount,
  setUsernameOnce,
} from "@/lib/accounts";
import { getFeatureAccessState, MAGIC_RULES_FEATURE } from "@/lib/feature-access";
import { apiError, json, readJson } from "@/lib/http";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  const rate = await enforceAccountRateLimit(account.id, "username_set", 10, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many username attempts. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  if (!body || typeof body.username !== "string") {
    return apiError(400, "invalid_username", "Choose a username");
  }
  const result = await setUsernameOnce(account.id, body.username);
  if (!result.ok) {
    const status = result.code === "already_set" ? 409 : result.code === "unavailable" ? 409 : 400;
    return apiError(status, result.code, result.message);
  }
  const magicAccess = await getFeatureAccessState(result.profile.id, MAGIC_RULES_FEATURE);
  return json({
    account: {
      displayName: result.profile.displayName,
      username: result.profile.username,
    },
    features: {
      magicRules: magicAccess.status === "enabled",
    },
    featureRequests: {
      magicRules: magicAccess.status === "pending" ? "pending" : null,
    },
    tutorialStatus: result.profile.tutorialStatus,
    alreadySet: result.alreadySet,
    referral: result.referral,
  }, { status: result.alreadySet ? 200 : 201 });
}
