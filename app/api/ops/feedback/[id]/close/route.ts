import { ensureSchema, getDatabase } from "@/db";
import { authorizeFeedbackManage, opsCorsHeaders } from "@/lib/ops-auth";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface FeedbackStatusRow {
  status: "new" | "reviewed" | "closed";
}

function response(
  origin: string | null,
  payload: Record<string, unknown>,
  status = 200,
): Response {
  const headers = opsCorsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin");
  if (!(await authorizeFeedbackManage(request))) {
    return response(origin, { error: "not_authorized" }, 403);
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return response(origin, { error: "not_found" }, 404);
  }

  try {
    await ensureSchema();
    const db = getDatabase();
    const result = await db
      .prepare("UPDATE feedback SET status = 'closed' WHERE id = ? AND status <> 'closed'")
      .bind(id)
      .run();
    const changed = (result.meta.changes ?? 0) === 1;
    if (!changed) {
      const feedback = await db
        .prepare("SELECT status FROM feedback WHERE id = ?")
        .bind(id)
        .first<FeedbackStatusRow>();
      if (!feedback) {
        return response(origin, { error: "not_found" }, 404);
      }
    }

    return response(origin, {
      feedback: { id, status: "closed" },
      changed,
    });
  } catch {
    return response(origin, { error: "feedback_close_failed" }, 500);
  }
}
