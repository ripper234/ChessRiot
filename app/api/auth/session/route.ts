import {
  clearGoogleSessionCookie,
  googleLoginAvailable,
  googleSessionAccountFromHeaders,
} from "@/lib/google-auth";
import { getAccountProfile, upsertAccount } from "@/lib/accounts";
import { getFeatureAccessState, MAGIC_RULES_FEATURE } from "@/lib/feature-access";
import { json } from "@/lib/http";
import { createRequestTiming } from "@/lib/request-timing";
import { ensureSchema } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const timing = createRequestTiming();
  let account = await timing.measure("cookie", () => googleSessionAccountFromHeaders(request.headers));
  if (account) await timing.measure("schema", () => ensureSchema());
  let deleted = false;
  if (account) {
    const currentAccount = account;
    deleted = !(await timing.measure("upsert", () => upsertAccount(currentAccount)));
  }
  if (deleted) account = null;
  const profile = account ? await timing.measure("profile", () => getAccountProfile(account.id)) : null;
  const magicAccess = profile?.username
    ? await timing.measure("feature", () => getFeatureAccessState(profile.id, MAGIC_RULES_FEATURE))
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
      locale: profile.locale,
    } : null,
    features: { magicRules },
    featureRequests: {
      magicRules: magicAccess.status === "pending" ? "pending" : null,
    },
  });
  if (deleted) response.headers.append("set-cookie", clearGoogleSessionCookie());
  return timing.apply(response);
}
