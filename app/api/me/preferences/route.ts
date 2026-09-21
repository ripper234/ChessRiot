import { getDatabase } from "@/db";
import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  const body = await readJson(request);
  if (!body || (body.locale !== "en" && body.locale !== "he") || Object.keys(body).some(key => !["locale", "expectedUsername"].includes(key))) {
    return apiError(400, "invalid_locale", "Choose English or Hebrew");
  }
  if (!account.username || body.expectedUsername !== account.username) return apiError(409, "account_changed", "Your account changed. Refresh and try again.");
  const rate = await enforceAccountRateLimit(account.id, "preferences", 60, 60);
  if (!rate.allowed) return apiError(429, "rate_limited", "Try again later");
  const result = await getDatabase().prepare("UPDATE accounts SET locale = ? WHERE id = ?")
    .bind(body.locale, account.id).run();
  if (result.meta.changes !== 1) return apiError(404, "account_not_found", "Account not found");
  return json({ locale: body.locale });
}
