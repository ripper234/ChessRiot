import { requestIdentity, mintPlayerSession, playerSessionCookie, verifyTurnstileToken } from "@/lib/account-auth";
import { enforceAccountRateLimit, upsertAccount } from "@/lib/accounts";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return new Response("Request origin is not allowed", { status: 403 });
  }
  const account = await requestIdentity(request);
  if (!account) {
    return Response.redirect(new URL("/signin-with-chatgpt?return_to=%2Fverify", request.url), 303);
  }
  const rate = await enforceAccountRateLimit(account.id, "captcha", 10, 10 * 60);
  if (!rate.allowed) {
    return new Response("Too many verification attempts. Try again shortly.", {
      status: 429,
      headers: { "retry-after": String(rate.retryAfter) },
    });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Invalid verification request", { status: 400 });
  }
  const token = form.get("cf-turnstile-response");
  const returnTo = safeRelativeReturnPath(String(form.get("returnTo") ?? "/"));
  if (
    typeof token !== "string" ||
    !await verifyTurnstileToken(
      token,
      new URL(request.url).hostname,
      crypto.randomUUID(),
    )
  ) {
    return Response.redirect(
      new URL(`/verify?failed=1&return_to=${encodeURIComponent(returnTo)}`, request.url),
      303,
    );
  }
  await upsertAccount(account);
  const session = await mintPlayerSession(account);
  if (!session) return new Response("Account security is not configured", { status: 503 });
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(returnTo, request.url).toString(),
      "set-cookie": playerSessionCookie(session),
      "cache-control": "no-store",
    },
  });
}
