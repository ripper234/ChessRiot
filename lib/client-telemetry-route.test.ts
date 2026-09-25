import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public-rate-limit", () => ({
  enforcePublicRateLimit: async () => ({ allowed: true, retryAfter: 0 }),
}));

import { POST } from "../app/api/telemetry/client/route";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
function request(payload: Record<string, unknown>): Request {
  return new Request("https://chessriot.gg/api/telemetry/client", {
    method: "POST",
    headers: {
      origin: "https://chessriot.gg",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ requestId: REQUEST_ID, ...payload }),
  });
}

describe("notification board telemetry", () => {
  it("accepts only a bounded duration and an observed window category", async () => {
    expect((await POST(request({ event: "notification.board_painted", elapsedMs: 728, mode: "new-window" }))).status).toBe(204);
    for (const payload of [
      { event: "notification.board_painted", elapsedMs: -1, mode: "same-game" },
      { event: "notification.board_painted", elapsedMs: 120_001, mode: "same-game" },
      { event: "notification.board_painted", elapsedMs: 1.5, mode: "same-game" },
      { event: "notification.board_painted", elapsedMs: 400, mode: "unknown" },
      { event: "notification.board_painted", elapsedMs: 400, mode: "new-window", gameId: REQUEST_ID },
      { event: "notification.board_painted", elapsedMs: 400, mode: "new-window", fen: "private" },
    ]) {
      expect((await POST(request(payload))).status).toBe(400);
    }
  });
});
