import { json } from "@/lib/http";
import { publicPushConfig } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await publicPushConfig());
}
