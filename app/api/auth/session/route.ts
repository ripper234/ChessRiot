import {
  clearGoogleSessionCookie,
  googleLoginAvailable,
  googleSessionAccountFromHeaders,
} from "@/lib/google-auth";
import { getAccountProfile, upsertAccount } from "@/lib/accounts";
import { getFeatureAccessState, MAGIC_RULES_FEATURE } from "@/lib/feature-access";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let account = await googleSessionAccountFromHeaders(request.headers);
  const deleted = account ? !(await upsertAccount(account)) : false;
  if (deleted) account = null;
  const profile = account ? await getAccountProfile(account.id) : null;
  const magicAccess = profile?.username
    ? await getFeatureAccessState(profile.id, MAGIC_RULES_FEATURE)
    : { feature: MAGIC_RULES_FEATURE, status: "none" as const, requestedAt: null };
  const magicRules = magicAccess.status === "enabled";
  const response = json({
    available: googleLoginAvailable(),
    signedIn: Boolean(account),
    ...(deleted ? { deleted: true } : {}),
    needsUsername: Boolean(account && !profile?.username),
    account: profile ? {
      displayName: profile.displayName,
      username: profile.username,
      tutorialStatus: profile.tutorialStatus,
    } : null,
    features: { magicRules },
    featureRequests: {
      magicRules: magicAccess.status === "pending" ? "pending" : null,
    },
  });
  if (deleted) response.headers.append("set-cookie", clearGoogleSessionCookie());
  return response;
}
