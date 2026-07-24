import { ensureSchema, getDatabase } from "@/db";
import { authorizeOpsRead, opsCorsHeaders } from "@/lib/ops-auth";
import { appEnvironment } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

interface CountRow {
  total: number;
  successes: number;
  rejections: number;
  failures: number;
  unique_subjects: number;
  average_latency_ms: number | null;
  last_event_at: string | null;
  last_error_at: string | null;
}

interface BreakdownRow {
  event_name: string;
  outcome: string;
  count: number;
}

interface RecentRow {
  occurred_at: string;
  event_name: string;
  outcome: string;
  request_id: string | null;
  subject_hash: string | null;
  route: string | null;
  method: string | null;
  status_code: number | null;
  error_code: string | null;
  latency_ms: number | null;
  metadata_json: string | null;
}

interface GameCountRow {
  waiting: number;
  active: number;
  completed: number;
}

interface FeedbackRow {
  id: string;
  title: string;
  comment: string | null;
  page: string;
  app_version: string;
  status: string;
  created_at: string;
}

function safeMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = opsCorsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!(await authorizeOpsRead(request))) {
    return new Response(JSON.stringify({ error: "not_authorized" }), {
      status: 403,
      headers,
    });
  }

  await ensureSchema();
  const db = getDatabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const [counts, breakdown, recent, gameCounts, latencyRows, feedbackRows] = await Promise.all([
    db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejections,
      SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failures,
      COUNT(DISTINCT subject_hash) AS unique_subjects,
      AVG(latency_ms) AS average_latency_ms,
      MAX(occurred_at) AS last_event_at,
      MAX(CASE WHEN outcome = 'failure' THEN occurred_at END) AS last_error_at
      FROM observability_events
      WHERE occurred_at >= ? AND event_name <> 'system.health_checked'`)
      .bind(since)
      .first<CountRow>(),
    db.prepare(`SELECT event_name, outcome, COUNT(*) AS count
      FROM observability_events
      WHERE occurred_at >= ? AND event_name <> 'system.health_checked'
      GROUP BY event_name, outcome
      ORDER BY event_name, outcome`)
      .bind(since)
      .all<BreakdownRow>(),
    db.prepare(`SELECT occurred_at, event_name, outcome, request_id,
      subject_hash, route, method, status_code, error_code, latency_ms,
      metadata_json
      FROM observability_events
      WHERE event_name <> 'system.health_checked'
      ORDER BY occurred_at DESC
      LIMIT 60`)
      .all<RecentRow>(),
    db.prepare(`SELECT
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM games`)
      .first<GameCountRow>(),
    db.prepare(`SELECT latency_ms FROM observability_events
      WHERE occurred_at >= ?
        AND event_name <> 'system.health_checked'
        AND latency_ms IS NOT NULL
      ORDER BY latency_ms ASC
      LIMIT 2000`)
      .bind(since)
      .all<{ latency_ms: number }>(),
    db.prepare(`SELECT id, title, comment, page, app_version, status, created_at
      FROM feedback
      ORDER BY created_at DESC
      LIMIT 100`)
      .all<FeedbackRow>(),
  ]);

  const latencyValues = (latencyRows.results ?? []).map((row) => row.latency_ms);
  const p95Index = Math.max(0, Math.ceil(latencyValues.length * 0.95) - 1);
  const normalizedCounts = counts ?? {
    total: 0,
    successes: 0,
    rejections: 0,
    failures: 0,
    unique_subjects: 0,
    average_latency_ms: null,
    last_event_at: null,
    last_error_at: null,
  };

  return new Response(JSON.stringify({
    status: "ok",
    environment: appEnvironment(),
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    windowHours: 24,
    games: gameCounts ?? { waiting: 0, active: 0, completed: 0 },
    totals: {
      total: normalizedCounts.total ?? 0,
      successes: normalizedCounts.successes ?? 0,
      rejections: normalizedCounts.rejections ?? 0,
      failures: normalizedCounts.failures ?? 0,
      uniqueGames: normalizedCounts.unique_subjects ?? 0,
      averageLatencyMs: normalizedCounts.average_latency_ms === null
        ? null
        : Math.round(normalizedCounts.average_latency_ms),
      p95LatencyMs: latencyValues.length ? latencyValues[p95Index] : null,
      lastEventAt: normalizedCounts.last_event_at,
      lastErrorAt: normalizedCounts.last_error_at,
    },
    breakdown: breakdown.results ?? [],
    recentEvents: (recent.results ?? []).map((row) => ({
      occurredAt: row.occurred_at,
      event: row.event_name,
      outcome: row.outcome,
      requestId: row.request_id,
      gameRef: row.subject_hash,
      route: row.route,
      method: row.method,
      statusCode: row.status_code,
      errorCode: row.error_code,
      latencyMs: row.latency_ms,
      metadata: safeMetadata(row.metadata_json),
    })),
    feedback: (feedbackRows.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      comment: row.comment,
      page: row.page,
      appVersion: row.app_version,
      status: row.status,
      createdAt: row.created_at,
    })),
  }), { headers });
}
