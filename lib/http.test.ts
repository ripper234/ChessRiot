import { describe, expect, it } from "vitest";
import { readJson } from "./http";

describe("readJson", () => {
  it("accepts a small JSON object", async () => {
    const request = new Request("https://chessriot.test/api", {
      method: "POST",
      body: JSON.stringify({ move: "e4" }),
    });
    await expect(readJson(request)).resolves.toEqual({ move: "e4" });
  });

  it("rejects oversized bodies even without a Content-Length header", async () => {
    const encoder = new TextEncoder();
    const payload = encoder.encode(JSON.stringify({ message: "x".repeat(9_000) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload.subarray(0, 4_000));
        controller.enqueue(payload.subarray(4_000));
        controller.close();
      },
    });
    const request = new Request("https://chessriot.test/api", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJson(request)).resolves.toBeNull();
  });

  it("rejects invalid UTF-8 and non-object JSON", async () => {
    const invalidUtf8 = new Request("https://chessriot.test/api", {
      method: "POST",
      body: new Uint8Array([0xc3, 0x28]),
    });
    await expect(readJson(invalidUtf8)).resolves.toBeNull();
    await expect(readJson(new Request("https://chessriot.test/api", {
      method: "POST",
      body: "[]",
    }))).resolves.toBeNull();
  });
});
