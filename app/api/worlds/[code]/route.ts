import { requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json } from "@/lib/http";
import { getMagicWorld } from "@/lib/magic-worlds";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  const { code } = await context.params;
  const world = await getMagicWorld(code);
  return world ? json({ world }) : apiError(404, "not_found", "World not found");
}
