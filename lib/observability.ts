import { ensureSchema, getDatabase } from "@/db";
import { APP_VERSION } from "./version";
import { appEnvironment, observabilityHashSecret } from "./runtime";

export type EventOutcome = "success" | "rejected" | "failure";

export interface ObservabilityEvent {
  event: string;
  outcome: EventOutcome;
  requestId?: string | null;
  subjectId?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  metadata?: Record<string, string | number | boolean | null>;
}

function boundedMetadata(
  metadata: ObservabilityEvent["metadata"],
): string | null {
  if (!metadata) return null;
  const safe = Object.fromEntries(
    Object.entries(metadata)
      .slice(0, 16)
      .map(([key, value]) => [key.slice(0, 40), value]),
  );
  const encoded = JSON.stringify(safe);
  return encoded.length <= 2_000 ? encoded : JSON.stringify({ truncated: true });
}

export async function hashOpaque(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const secret = observabilityHashSecret();
  const digest = secret
    ? await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
      new TextEncoder().encode(value),
    )
    : await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

export async function recordEvent(input: ObservabilityEvent): Promise<void> {
  const record = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    environment: appEnvironment(),
    appVersion: APP_VERSION,
    event: input.event.slice(0, 80),
    outcome: input.outcome,
    requestId: input.requestId?.slice(0, 80) ?? null,
    subjectHash: await hashOpaque(input.subjectId),
    route: input.route?.slice(0, 120) ?? null,
    method: input.method?.slice(0, 12) ?? null,
    statusCode: input.statusCode ?? null,
    errorCode: input.errorCode?.slice(0, 80) ?? null,
    latencyMs: input.latencyMs === undefined || input.latencyMs === null
      ? null
      : Math.max(0, Math.round(input.latencyMs)),
    metadataJson: boundedMetadata(input.metadata),
  };

  try {
    await ensureSchema();
    await getDatabase()
      .prepare(`INSERT INTO observability_events (
        id, occurred_at, environment, app_version, event_name, outcome,
        request_id, subject_hash, route, method, status_code, error_code,
        latency_ms, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        record.id,
        record.occurredAt,
        record.environment,
        record.appVersion,
        record.event,
        record.outcome,
        record.requestId,
        record.subjectHash,
        record.route,
        record.method,
        record.statusCode,
        record.errorCode,
        record.latencyMs,
        record.metadataJson,
      )
      .run();

    // Roughly one in sixteen events performs bounded retention maintenance.
    if (Number.parseInt(record.id.at(-1) ?? "0", 16) === 0) {
      await getDatabase()
        .prepare("DELETE FROM observability_events WHERE occurred_at < ?")
        .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString())
        .run();
    }

    console.log(JSON.stringify({
      type: "chessriot_event",
      ...record,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      type: "chessriot_observability_failure",
      environment: record.environment,
      appVersion: record.appVersion,
      event: record.event,
      message: error instanceof Error ? error.message.slice(0, 240) : "Unknown logging error",
    }));
  }
}

interface RequestDetails {
  requestId: string;
  subjectId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  clientEvent: string | null;
}

function routeEvent(method: string, pathname: string): string | null {
  if (method === "POST" && pathname === "/api/games") return "game.created";
  if (method === "POST" && /^\/api\/invitations\/[^/]+\/join$/.test(pathname)) {
    return "invitation.claimed";
  }
  if (method === "GET" && /^\/api\/invitations\/[^/]+$/.test(pathname)) {
    return "invitation.opened";
  }
  if (method === "POST" && /^\/api\/games\/[^/]+\/moves$/.test(pathname)) {
    return "move.submitted";
  }
  if (method === "POST" && /^\/api\/games\/[^/]+\/claims$/.test(pathname)) {
    return "draw.claimed";
  }
  if (method === "GET" && /^\/api\/games\/[^/]+$/.test(pathname)) return "game.loaded";
  if (method === "POST" && pathname === "/api/telemetry/client") return "client.telemetry";
  if (method === "POST" && pathname === "/api/feedback") return "feedback.submitted";
  if (method === "GET" && pathname === "/api/health") return "system.health_checked";
  if (method === "GET" && pathname === "/api/ops/observability") {
    return "observability.viewed";
  }
  if (pathname.startsWith("/api/")) return "api.request";
  return null;
}

function subjectFromPath(pathname: string): string | null {
  return /^\/api\/games\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

async function requestDetails(request: Request): Promise<RequestDetails> {
  const generated = crypto.randomUUID();
  const pathname = new URL(request.url).pathname;
  const details: RequestDetails = {
    requestId: request.headers.get("x-request-id")?.slice(0, 80) || generated,
    subjectId: subjectFromPath(pathname),
    metadata: {},
    clientEvent: null,
  };
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return details;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return details;
    const payload = body as Record<string, unknown>;
    if (typeof payload.requestId === "string") details.requestId = payload.requestId;
    if (typeof payload.mode === "string") details.metadata.mode = payload.mode.slice(0, 20);
    if (typeof payload.difficulty === "number") details.metadata.difficulty = payload.difficulty;
    if (typeof payload.from === "string") details.metadata.from = payload.from.slice(0, 4);
    if (typeof payload.to === "string") details.metadata.to = payload.to.slice(0, 4);
    if (typeof payload.promotion === "string") {
      details.metadata.promotion = payload.promotion.slice(0, 4);
    }
    if (typeof payload.claim === "string") details.metadata.claim = payload.claim.slice(0, 40);
    if (
      payload.event === "client.error"
      || payload.event === "client.unhandled_rejection"
      || payload.event === "client.network_error"
    ) {
      details.clientEvent = payload.event;
    }
    if (typeof payload.gameId === "string") details.subjectId = payload.gameId;
    if (typeof payload.code === "string") details.metadata.code = payload.code.slice(0, 80);
  } catch {
    // Invalid request bodies are still logged from their response status.
  }
  return details;
}

async function responseDetails(
  response: Response,
): Promise<{
  errorCode: string | null;
  subjectId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}> {
  if (response.status === 204) return { errorCode: null, subjectId: null, metadata: {} };
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { errorCode: null, subjectId: null, metadata: {} };
  }
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { errorCode: null, subjectId: null, metadata: {} };
    }
    const payload = body as {
      error?: { code?: unknown };
      game?: {
        id?: unknown;
        mode?: unknown;
        status?: unknown;
        you?: { color?: unknown };
        outcome?: { reason?: unknown } | null;
        version?: unknown;
        plyCount?: unknown;
      };
    };
    const metadata: Record<string, string | number | boolean | null> = {};
    if (typeof payload.game?.mode === "string") metadata.mode = payload.game.mode;
    if (typeof payload.game?.status === "string") metadata.gameStatus = payload.game.status;
    if (typeof payload.game?.you?.color === "string") metadata.playerColor = payload.game.you.color;
    if (typeof payload.game?.outcome?.reason === "string") {
      metadata.termination = payload.game.outcome.reason;
    }
    if (typeof payload.game?.version === "number") metadata.gameVersion = payload.game.version;
    if (typeof payload.game?.plyCount === "number") metadata.plyCount = payload.game.plyCount;
    return {
      errorCode: typeof payload.error?.code === "string" ? payload.error.code : null,
      subjectId: typeof payload.game?.id === "string" ? payload.game.id : null,
      metadata,
    };
  } catch {
    return { errorCode: null, subjectId: null, metadata: {} };
  }
}

export async function observeHttpRequest(
  request: Request,
  response: Response,
  startedAt: number,
  preparedDetails: Promise<RequestDetails>,
): Promise<void> {
  const url = new URL(request.url);
  const baseEvent = routeEvent(request.method, url.pathname);
  if (!baseEvent) return;
  if (
    baseEvent === "game.loaded"
    && response.status < 400
    && url.searchParams.has("sinceVersion")
  ) return;
  if (baseEvent === "observability.viewed") return;

  const [requestInfo, responseInfo] = await Promise.all([
    preparedDetails,
    responseDetails(response),
  ]);
  const outcome: EventOutcome = response.status >= 500
    ? "failure"
    : response.status >= 400 ? "rejected" : "success";
  const event = requestInfo.clientEvent && baseEvent === "client.telemetry"
    ? requestInfo.clientEvent
    : baseEvent;
  await recordEvent({
    event,
    outcome,
    requestId: requestInfo.requestId,
    subjectId: requestInfo.subjectId ?? responseInfo.subjectId,
    route: url.pathname.replace(
      /^\/api\/games\/[^/]+/,
      "/api/games/:id",
    ).replace(
      /^\/api\/invitations\/[^/]+/,
      "/api/invitations/:token",
    ),
    method: request.method,
    statusCode: response.status,
    errorCode: responseInfo.errorCode,
    latencyMs: performance.now() - startedAt,
    metadata: { ...requestInfo.metadata, ...responseInfo.metadata },
  });
}

export function prepareRequestObservation(request: Request): Promise<RequestDetails> {
  return requestDetails(request.clone() as unknown as Request);
}
