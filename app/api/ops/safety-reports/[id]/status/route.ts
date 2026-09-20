import { authorizeSafetyManage, opsCorsHeaders } from "@/lib/ops-auth";
import { updateSafetyReportStatus } from "@/lib/safety";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const headers = opsCorsHeaders(request.headers.get("origin"));
  if (!(await authorizeSafetyManage(request))) {
    return Response.json({ error: "not_authorized" }, { status: 403, headers });
  }
  const { id } = await context.params;
  const status = new URL(request.url).searchParams.get("status");
  if (!isUuid(id) || (status !== "reviewed" && status !== "closed")) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers });
  }
  if (!(await updateSafetyReportStatus(id, status))) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  return Response.json({ status: "ok", report: { id, status } }, { headers });
}
