import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json } from "@/lib/http";
import { claimReferral, isReferralCode } from "@/lib/referrals";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  const { code } = await context.params;
  if (!isReferralCode(code)) return apiError(404, "not_found", "Invite link not found");
  const rate = await enforceAccountRateLimit(account.id, "referral_claim", 20, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many invite attempts. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const result = await claimReferral(account, code);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 409;
    return apiError(status, result.code, result.message);
  }
  return json(result, { status: result.state === "awaiting_username" ? 202 : 200 });
}
