import { authorizeSafetyManage, opsCorsHeaders } from "@/lib/ops-auth";
import { listSafetyReports } from "@/lib/safety";
import { appEnvironment } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const headers = opsCorsHeaders(request.headers.get("origin"));
  if (!(await authorizeSafetyManage(request))) {
    return Response.json({ error: "not_authorized" }, { status: 403, headers });
  }
  return Response.json({
    status: "ok",
    environment: appEnvironment(),
    reports: await listSafetyReports(),
  }, { headers });
}
