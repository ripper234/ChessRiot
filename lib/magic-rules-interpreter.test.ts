import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interpretMagicPrompt,
  MAGIC_COMPILER_MODEL,
  MAGIC_COMPILER_SYSTEM_PROMPT,
} from "./magic-rules-interpreter";

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
  vi.restoreAllMocks();
});

describe("runtime Magic interpreter", () => {
  it.each([
    ["Knights move twice", 2],
    ["Knights move 2 times", 2],
    ["Knights move 3 times", 3],
    ["פרשים זזים 3 פעמים", 3],
  ])("compiles %s into the model-provided numeric count", async (prompt, maxMoves) => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return modelResponse({
        verdict: "supported",
        rules: [{
          kind: "move_sequence",
          pieces: ["n"],
          maxMoves,
          action: null,
        }],
        message: "",
      });
    });

    const result = await interpretMagicPrompt(prompt, {
      apiKey: "test-key",
      fetch: fetchMock as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      prompt,
      compiled: {
        version: 3,
        rules: [{
          kind: "move_sequence",
          pieces: ["n"],
          maxMoves,
        }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      model: MAGIC_COMPILER_MODEL,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          strict: true,
        },
      },
    });
    const bodyText = JSON.stringify(requestBody);
    expect(bodyText).toContain(prompt);
    expect(MAGIC_COMPILER_SYSTEM_PROMPT).toContain("same physical piece");
    expect(bodyText).toContain("same physical piece");
    expect(bodyText).not.toContain("test-key");
  });

  it("rejects the entire prompt when any clause is unsupported", async () => {
    const fetchMock = vi.fn(async () => modelResponse({
      verdict: "unsupported",
      rules: [],
      message: "Exploding queens are outside the deterministic rule engine.",
    }));

    await expect(interpretMagicPrompt(
      "Knights move 3 times and queens explode",
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    )).resolves.toEqual({
      ok: false,
      code: "unsupported",
      message: "Exploding queens are outside the deterministic rule engine.",
    });
  });

  it("rejects counts beyond the six-move engine cap", async () => {
    const fetchMock = vi.fn(async () => modelResponse({
      verdict: "unsupported",
      rules: [],
      message: "The maximum supported count is 6.",
    }));
    await expect(interpretMagicPrompt(
      "Knights move 7 times",
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    )).resolves.toMatchObject({ ok: false, code: "unsupported" });
  });

  it("fails closed on malformed or extra model fields", async () => {
    const fetchMock = vi.fn(async () => modelResponse({
      verdict: "supported",
      rules: [{
        kind: "move_sequence",
        pieces: ["n"],
        maxMoves: 3,
        action: null,
        extra: true,
      }],
      message: "",
    }));
    await expect(interpretMagicPrompt(
      "Knights move 3 times",
      { apiKey: "test-key", fetch: fetchMock as typeof fetch },
    )).resolves.toEqual({
      ok: false,
      code: "unavailable",
      message: "Magic could not safely validate that rule. Try rephrasing it.",
    });
  });
});
