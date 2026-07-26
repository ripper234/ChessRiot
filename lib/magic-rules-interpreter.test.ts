import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretMagicPrompt } from "./magic-rules-interpreter";

const originalFetch = globalThis.fetch;

function modelResponse(value: unknown): Response {
  return new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify(value),
      }],
    }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.__CHESSRIOT_OPENAI_API_KEY__ = undefined;
  vi.restoreAllMocks();
});

describe("runtime Magic interpreter", () => {
  it("accepts model-structured meaning and produces a validated immutable rule", async () => {
    globalThis.__CHESSRIOT_OPENAI_API_KEY__ = "test-key";
    let sentInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      sentInit = init;
      return modelResponse({
      verdict: "supported",
      rules: [{
        kind: "move_sequence",
        pieces: ["n"],
        maxMoves: 3,
        action: null,
      }],
      message: "",
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await interpretMagicPrompt("פרשים זזים 3 פעמים");

    expect(result).toMatchObject({
      ok: true,
      prompt: "פרשים זזים 3 פעמים",
      compiled: {
        version: 3,
        rules: [{
          kind: "move_sequence",
          pieces: ["n"],
          maxMoves: 3,
        }],
      },
    });
    const body = JSON.parse(String(sentInit?.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      text: {
        format: {
          type: "json_schema",
          strict: true,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-key");
  });

  it("returns a safe unsupported response without storing guessed rules", async () => {
    globalThis.__CHESSRIOT_OPENAI_API_KEY__ = "test-key";
    globalThis.fetch = vi.fn(async () => modelResponse({
      verdict: "unsupported",
      rules: [],
      message: "Exploding queens are outside the deterministic rule engine.",
    })) as typeof fetch;

    await expect(interpretMagicPrompt("Queens explode")).resolves.toEqual({
      ok: false,
      code: "unsupported",
      message: "This rule cannot be compiled safely yet.",
    });
  });

  it("fails closed when the model output violates the rule document", async () => {
    globalThis.__CHESSRIOT_OPENAI_API_KEY__ = "test-key";
    globalThis.fetch = vi.fn(async () => modelResponse({
      verdict: "supported",
      rules: [{
        kind: "move_sequence",
        pieces: ["n"],
        maxMoves: 99,
        action: null,
      }],
      message: "",
    })) as typeof fetch;

    await expect(interpretMagicPrompt("Knights move 99 times")).resolves.toEqual({
      ok: false,
      code: "unavailable",
      message: "Magic could not safely validate that rule. Try rephrasing it.",
    });
  });
});
