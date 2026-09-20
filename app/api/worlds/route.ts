import { requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json } from "@/lib/http";
import { getMagicWorldMap, listMagicWorlds } from "@/lib/magic-worlds";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const search = new URL(request.url).searchParams;
  if (search.get("view") === "map") {
    return json(await getMagicWorldMap(account.id));
  }
  const requestedScope = search.get("scope");
  const scope = requestedScope === "new" || requestedScope === "mine"
    ? requestedScope
    : "popular";
  return json({ worlds: await listMagicWorlds(account.id, scope) });
}
