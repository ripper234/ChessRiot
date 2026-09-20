import { requireGoogleApiAccount, setTutorialStatus } from "@/lib/accounts";
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
  const status = body?.action === "complete"
    ? "completed"
    : body?.action === "skip"
      ? "skipped"
      : body?.action === "replay"
        ? "pending"
        : null;
  if (!status) return apiError(400, "invalid_action", "Choose complete, skip, or replay");
  if (!(await setTutorialStatus(account.id, status))) {
    return apiError(404, "account_not_found", "Account not found");
  }
  return json({ tutorialStatus: status });
}
