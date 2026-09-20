import { ensureSchema, getDatabase } from "@/db";
import { isGameVariantId } from "./game-variants";
import { isUuid } from "./validation";
import { APP_VERSION } from "./version";
import { appEnvironment, observabilityHashSecret } from "./runtime";
import { readJson } from "./http";
import { googleSessionAccountFromHeaders } from "./google-auth";

export type EventOutcome = "success" | "rejected" | "failure";

export interface ObservabilityEvent {
  event: string;
  outcome: EventOutcome;
  requestId?: string | null;
  subjectId?: string | null;
  actorId?: string | null;
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
  if (!secret && !["local", "test"].includes(appEnvironment())) return null;
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
    requestId: isUuid(input.requestId) ? input.requestId : null,
    subjectHash: await hashOpaque(input.subjectId),
    actorHash: await hashOpaque(input.actorId),
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
        request_id, subject_hash, actor_hash, route, method, status_code,
        error_code, latency_ms, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        record.id,
        record.occurredAt,
        record.environment,
        record.appVersion,
        record.event,
        record.outcome,
        record.requestId,
        record.subjectHash,
        record.actorHash,
        record.route,
        record.method,
        record.statusCode,
        record.errorCode,
        record.latencyMs,
        record.metadataJson,
      )
      .run();

    console.log(JSON.stringify({
      type: "chessriot_event",
      occurredAt: record.occurredAt,
      environment: record.environment,
      appVersion: record.appVersion,
      event: record.event,
      outcome: record.outcome,
      route: record.route,
      method: record.method,
      statusCode: record.statusCode,
      errorCode: record.errorCode,
      latencyMs: record.latencyMs,
      metadataJson: record.metadataJson,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      type: "chessriot_observability_failure",
      environment: record.environment,
      appVersion: record.appVersion,
      event: record.event,
      errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
    }));
  }
}

interface RequestDetails {
  requestId: string;
  subjectId: string | null;
  actorId: string | null;
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
  if (method === "POST" && /^\/api\/games\/[^/]+\/end$/.test(pathname)) {
    return "game.ended";
  }
  if (method === "PATCH" && /^\/api\/games\/[^/]+\/challenge$/.test(pathname)) {
    return "challenge.responded";
  }
  if (method === "POST" && /^\/api\/games\/[^/]+\/reactions$/.test(pathname)) {
    return "reaction.sent";
  }
  if (method === "POST" && /^\/api\/games\/[^/]+\/recap-share$/.test(pathname)) {
    return "recap.shared";
  }
  if (method === "DELETE" && /^\/api\/games\/[^/]+\/recap-share$/.test(pathname)) {
    return "recap.revoked";
  }
  if (method === "PUT" && /^\/api\/games\/[^/]+\/push-subscriptions$/.test(pathname)) {
    return "push.subscription_enabled";
  }
  if (method === "DELETE" && /^\/api\/games\/[^/]+\/push-subscriptions$/.test(pathname)) {
    return "push.subscription_disabled";
  }
  if (method === "PUT" && pathname === "/api/me/push-devices") {
    return "push.device_enabled";
  }
  if (method === "DELETE" && pathname === "/api/me/push-devices") {
    return "push.device_disabled";
  }
  if (method === "GET" && /^\/api\/games\/[^/]+\/reactions$/.test(pathname)) {
    return null;
  }
  if (method === "GET" && /^\/api\/games\/[^/]+$/.test(pathname)) return "game.loaded";
  if (method === "GET" && pathname === "/api/me/games") return null;
  if (method === "POST" && pathname === "/api/telemetry/client") return "client.telemetry";
  if (method === "POST" && pathname === "/api/me/username") return "username.chosen";
  if (method === "POST" && pathname === "/api/me/tutorial") return "tutorial.updated";
  if (method === "POST" && pathname === "/api/me/feature-access") {
    return "feature_access.requested";
  }
  if (method === "POST" && pathname === "/api/me/friend-requests") return "friend_request.sent";
  if (method === "PATCH" && /^\/api\/me\/friend-requests\/[^/]+$/.test(pathname)) {
    return "friend_request.responded";
  }
  if (method === "DELETE" && /^\/api\/me\/friend-requests\/[^/]+$/.test(pathname)) {
    return "friend_request.cancelled";
  }
  if (method === "POST" && pathname === "/api/me/blocks") return "player.blocked";
  if (method === "DELETE" && pathname === "/api/me/blocks") return "player.unblocked";
  if (method === "POST" && pathname === "/api/me/reports") return "player.reported";
  if (method === "POST" && pathname === "/api/me/activity") return "activity.read";
  if (method === "GET" && pathname === "/api/me/export") return "privacy.exported";
  if (method === "DELETE" && pathname === "/api/me/account") return "privacy.deleted";
  if (method === "POST" && pathname === "/api/feedback") return "feedback.submitted";
  if (
    method === "POST"
    && /^\/api\/ops\/feedback\/[^/]+\/close$/.test(pathname)
  ) return "feedback.closed";
  // Health and dashboard polling are operational reads, not product actions.
  // Omitting them keeps the recent-event feed focused on player and system events.
  if (
    (method === "GET" && pathname === "/api/health")
    || (method === "GET" && pathname === "/api/push/config")
    || (method === "GET" && /^\/api\/games\/[^/]+\/notification-test$/.test(pathname))
    || (method === "GET" && /^\/api\/games\/[^/]+\/push-subscriptions$/.test(pathname))
    || (method === "GET" && pathname === "/api/me/push-devices")
    || (method === "POST" && pathname === "/api/ops/push-notifications")
    || (method === "GET" && pathname === "/api/me/activity")
    || (method === "POST" && pathname === "/api/ops/overview")
    || (method === "POST" && pathname === "/api/ops/analytics")
    || (method === "POST" && pathname === "/api/ops/safety-reports")
    || (method === "POST" && /^\/api\/ops\/safety-reports\/[^/]+\/status$/.test(pathname))
    || (method === "POST" && pathname === "/api/ops/feature-access-requests")
  ) return null;
  if (pathname.startsWith("/api/")) return "api.request";
  return null;
}

function subjectFromPath(pathname: string): string | null {
  return /^\/api\/games\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

export function sanitizeObservedRoute(pathname: string): string {
  return pathname.replace(
    /^\/api\/games\/[^/]+/,
    "/api/games/:id",
  ).replace(
    /^\/api\/invitations\/[^/]+/,
    "/api/invitations/:token",
  ).replace(
    /^\/api\/referrals\/[^/]+/,
    "/api/referrals/:code",
  ).replace(
    /^\/api\/me\/friend-requests\/[^/]+/,
    "/api/me/friend-requests/:id",
  ).replace(
    /^\/api\/ops\/feedback\/[^/]+/,
    "/api/ops/feedback/:id",
  );
}

async function requestDetails(request: Request): Promise<RequestDetails> {
  const generated = crypto.randomUUID();
  const pathname = new URL(request.url).pathname;
  const headerRequestId = request.headers.get("x-request-id");
  const sessionAccount = await googleSessionAccountFromHeaders(request.headers);
  const details: RequestDetails = {
    requestId: isUuid(headerRequestId) ? headerRequestId : generated,
    subjectId: subjectFromPath(pathname),
    actorId: sessionAccount?.id ?? null,
    metadata: {},
    clientEvent: null,
  };
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return details;
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return details;
  }
  try {
    const body: unknown = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return details;
    const payload = body as Record<string, unknown>;
    if (isUuid(payload.requestId)) details.requestId = payload.requestId;
    if (typeof payload.mode === "string") details.metadata.mode = payload.mode.slice(0, 20);
    if (isGameVariantId(payload.variantId)) details.metadata.variantId = payload.variantId;
    if (typeof payload.difficulty === "number") details.metadata.difficulty = payload.difficulty;
    if (typeof payload.turnPaceDays === "number") {
      details.metadata.turnPaceDays = payload.turnPaceDays;
    }
    if (typeof payload.claim === "string") details.metadata.claim = payload.claim.slice(0, 40);
    if (typeof payload.event === "string" && [
      "client.error",
      "client.unhandled_rejection",
      "client.network_error",
      "public.home_viewed",
      "demo.started",
      "demo.completed",
      "auth.started",
      "tutorial.started",
      "tutorial.completed",
      "tutorial.skipped",
      "activity.opened",
    ].includes(payload.event)) {
      details.clientEvent = payload.event;
    }
    if (typeof payload.gameId === "string") details.subjectId = payload.gameId;
    if (typeof payload.code === "string") details.metadata.code = payload.code.slice(0, 80);
    if (payload.feature === "magic_rules") details.metadata.feature = payload.feature;
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
        variantId?: unknown;
        status?: unknown;
        you?: { color?: unknown };
        outcome?: { reason?: unknown } | null;
        version?: unknown;
        plyCount?: unknown;
      };
      reaction?: {
        key?: unknown;
        senderColor?: unknown;
        sequence?: unknown;
      };
    };
    const metadata: Record<string, string | number | boolean | null> = {};
    if (typeof payload.game?.mode === "string") metadata.mode = payload.game.mode;
    if (isGameVariantId(payload.game?.variantId)) {
      metadata.variantId = payload.game.variantId;
    }
    if (typeof payload.game?.status === "string") metadata.gameStatus = payload.game.status;
    if (typeof payload.game?.you?.color === "string") metadata.playerColor = payload.game.you.color;
    if (typeof payload.game?.outcome?.reason === "string") {
      metadata.termination = payload.game.outcome.reason;
    }
    if (typeof payload.game?.version === "number") metadata.gameVersion = payload.game.version;
    if (typeof payload.game?.plyCount === "number") metadata.plyCount = payload.game.plyCount;
    if (typeof payload.reaction?.key === "string") metadata.reaction = payload.reaction.key;
    if (typeof payload.reaction?.senderColor === "string") {
      metadata.playerColor = payload.reaction.senderColor;
    }
    if (typeof payload.reaction?.sequence === "number") {
      metadata.reactionSequence = payload.reaction.sequence;
    }
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
  const [requestInfo, responseInfo] = await Promise.all([
    preparedDetails,
    responseDetails(response),
  ]);
  const outcome: EventOutcome = response.status >= 500
    ? "failure"
    : response.status >= 400 ? "rejected" : "success";
  let event = requestInfo.clientEvent && baseEvent === "client.telemetry"
    ? requestInfo.clientEvent
    : baseEvent;
  if (baseEvent === "reaction.sent" && response.status === 200) {
    event = "reaction.retry";
  }
  const requestEvent = recordEvent({
    event,
    outcome,
    requestId: requestInfo.requestId,
    subjectId: requestInfo.subjectId ?? responseInfo.subjectId,
    actorId: requestInfo.actorId,
    route: sanitizeObservedRoute(url.pathname),
    method: request.method,
    statusCode: response.status,
    errorCode: responseInfo.errorCode,
    latencyMs: performance.now() - startedAt,
    metadata: { ...requestInfo.metadata, ...responseInfo.metadata },
  });
  const botCommitted = response.headers.get("x-chessriot-bot-committed") === "1";
  const botLatency = Number(response.headers.get("x-chessriot-bot-latency-ms"));
  const botDifficulty = Number(response.headers.get("x-chessriot-bot-difficulty"));
  await Promise.all([
    requestEvent,
    ...(botCommitted
      ? [recordEvent({
        event: "bot.move_committed",
        outcome: "success",
        requestId: requestInfo.requestId,
        subjectId: requestInfo.subjectId ?? responseInfo.subjectId,
        actorId: requestInfo.actorId,
        latencyMs: Number.isFinite(botLatency) ? botLatency : null,
        metadata: {
          color: response.headers.get("x-chessriot-bot-color") === "w" ? "w" : "b",
          difficulty: Number.isInteger(botDifficulty) ? botDifficulty : null,
          variantId: typeof responseInfo.metadata.variantId === "string"
            ? responseInfo.metadata.variantId
            : null,
          gameStatus: typeof responseInfo.metadata.gameStatus === "string"
            ? responseInfo.metadata.gameStatus
            : null,
          magic: response.headers.get("x-chessriot-bot-magic") === "1",
          inline: true,
        },
      })]
      : []),
  ]);
}

export function prepareRequestObservation(request: Request): Promise<RequestDetails> {
  return requestDetails(request.clone() as unknown as Request);
}
