"use client";

import { generateUuid } from "./client-storage";

export type ClientEvent =
  | "client.error"
  | "client.unhandled_rejection"
  | "client.network_error";

export type ProductEvent =
  | "public.home_viewed"
  | "demo.started"
  | "demo.completed"
  | "auth.started"
  | "tutorial.started"
  | "tutorial.completed"
  | "tutorial.skipped"
  | "activity.opened";

export function reportClientEvent(
  event: ClientEvent,
  code: string,
): void {
  const payload = JSON.stringify({
    requestId: generateUuid(),
    event,
    code: code.slice(0, 80),
  });
  void fetch("/api/telemetry/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function reportProductEvent(event: ProductEvent): void {
  void fetch("/api/telemetry/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: generateUuid(), event }),
    keepalive: true,
  }).catch(() => undefined);
}
