import {
  clearGoogleFlowCookie,
  clearGoogleSessionCookie,
  exchangeGoogleCode,
  googleFlowFromHeaders,
  googleSessionCookie,
} from "@/lib/google-auth";
import { upsertGoogleCallbackAccount } from "@/lib/referrals";
import { recordEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    location,
  });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const flow = await googleFlowFromHeaders(request.headers);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (
    !flow
    || !state
    || state !== flow.state
    || !code
    || url.searchParams.has("error")
  ) {
    return redirect("/app?auth=google_failed", [clearGoogleFlowCookie()]);
  }
  const account = await exchangeGoogleCode(code, flow);
  if (!account) {
    return redirect("/app?auth=google_failed", [clearGoogleFlowCookie()]);
  }
  const referralCode = /^\/invite\/([A-Za-z0-9_-]{16})$/.exec(flow.returnTo)?.[1] ?? null;
  const persisted = await upsertGoogleCallbackAccount(account, referralCode);
  if (persisted.deleted) {
    return redirect("/app?auth=account_deleted", [
      clearGoogleFlowCookie(),
      clearGoogleSessionCookie(),
    ]);
  }
  const session = await googleSessionCookie(account);
  if (!session) {
    return redirect("/app?auth=google_failed", [clearGoogleFlowCookie()]);
  }
  await recordEvent({
    event: "auth.completed",
    outcome: "success",
    actorId: account.id,
    metadata: {
      newAccount: persisted.created,
      referralReserved: persisted.referralReserved,
    },
  });
  return redirect(flow.returnTo, [clearGoogleFlowCookie(), session]);
}
