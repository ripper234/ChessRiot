import { requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json } from "@/lib/http";
import { getReferralSummary } from "@/lib/referrals";
import { applicationOrigin } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const summary = await getReferralSummary(account.id);
  return json({
    ...summary,
    inviteUrl: `${applicationOrigin(request)}/invite/${summary.code}`,
  });
}
