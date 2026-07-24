"use client";

export type ClientEvent =
  | "client.error"
  | "client.unhandled_rejection"
  | "client.network_error";

export function reportClientEvent(
  event: ClientEvent,
  code: string,
  gameId?: string,
): void {
  const payload = JSON.stringify({
    event,
    code: code.slice(0, 80),
    ...(gameId ? { gameId } : {}),
  });
  void fetch("/api/telemetry/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}
