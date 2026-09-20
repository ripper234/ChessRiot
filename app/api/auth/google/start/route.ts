import { createGoogleOAuthStart } from "@/lib/google-auth";
import { configuredAppOrigin } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("return_to");
  const reauthenticate = requestUrl.searchParams.get("reauth") === "1";
  const canonicalOrigin = configuredAppOrigin();
  if (canonicalOrigin && requestUrl.origin !== canonicalOrigin) {
    const target = new URL("/api/auth/google/start", canonicalOrigin);
    if (returnTo) target.searchParams.set("return_to", returnTo);
    if (reauthenticate) target.searchParams.set("reauth", "1");
    return new Response(null, {
      status: 307,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        location: target.toString(),
      },
    });
  }
  const start = await createGoogleOAuthStart(returnTo, undefined, reauthenticate);
  if (!start) {
    return Response.json(
      { error: "google_login_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      location: start.authorizationUrl,
      "set-cookie": start.flowCookie,
    },
  });
}
