import { expect, it } from "vitest";
import { OPENAI_SMOKE_MARKER, runOpenAiSmoke } from "./openai-smoke";

it.skipIf(process.env.RUN_OPENAI_LIVE_TEST !== "1")(
  "gets the tiny ChessRiot marker from the selected environment LLM key",
  async () => {
    const target = process.env.OPENAI_LIVE_TARGET;
    expect(["development", "production"], "Set OPENAI_LIVE_TARGET explicitly")
      .toContain(target);
    const keyName = target === "development"
      ? "OPENAI_API_KEY_DEV"
      : "OPENAI_API_KEY_PROD";
    const key = process.env[keyName];
    expect(key, `${keyName} must be configured for the selected target`).toBeTruthy();

    globalThis.__CHESSRIOT_ENV__ = target;
    globalThis.__CHESSRIOT_OPENAI_API_KEY_DEV__ = target === "development" ? key : undefined;
    globalThis.__CHESSRIOT_OPENAI_API_KEY_PROD__ = target === "production" ? key : undefined;
    try {
      const result = await runOpenAiSmoke();
      expect(result, `${OPENAI_SMOKE_MARKER} was not returned`).toMatchObject({
        ok: true,
        status: 200,
        error: null,
      });
    } finally {
      globalThis.__CHESSRIOT_ENV__ = undefined;
      globalThis.__CHESSRIOT_OPENAI_API_KEY_DEV__ = undefined;
      globalThis.__CHESSRIOT_OPENAI_API_KEY_PROD__ = undefined;
    }
  },
  30_000,
);
