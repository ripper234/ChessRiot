import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json } from "@/lib/http";
import { exportAccountData } from "@/lib/privacy";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const rate = await enforceAccountRateLimit(account.id, "account_export", 3, 24 * 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "You can download your data up to three times per day." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const data = await exportAccountData(account.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="chessriot-data-${date}.json"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
