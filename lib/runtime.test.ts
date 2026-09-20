import { afterEach, describe, expect, it } from "vitest";
import {
  applicationOrigin,
  configuredAppOrigin,
  controlOrigin,
  googleClientId,
  openAiApiKey,
  runtimeReadiness,
} from "./runtime";

afterEach(() => {
  globalThis.__CHESSRIOT_ENV__ = undefined;
  globalThis.__CHESSRIOT_APP_ORIGIN__ = undefined;
  globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = undefined;
  globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = undefined;
  globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__ = undefined;
  globalThis.__CHESSRIOT_OPENAI_API_KEY__ = undefined;
  globalThis.__CHESSRIOT_OPENAI_API_KEY_DEV__ = undefined;
  globalThis.__CHESSRIOT_OPENAI_API_KEY_PROD__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_PROD__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_PROD__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_PROD__ = undefined;
});

describe("runtime origins", () => {
  it("accepts local HTTP origins", () => {
    globalThis.__CHESSRIOT_ENV__ = "local";
    globalThis.__CHESSRIOT_APP_ORIGIN__ = "http://localhost:3000";
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = "http://localhost:3001";

    expect(configuredAppOrigin()).toBe("http://localhost:3000");
    expect(controlOrigin()).toBe("http://localhost:3001");
    expect(runtimeReadiness().core).toBe(true);
  });

  it("rejects insecure, path-bearing, and malformed hosted origins", () => {
    globalThis.__CHESSRIOT_ENV__ = "production";
    globalThis.__CHESSRIOT_APP_ORIGIN__ = "http://chessriot.gg";
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = "https://control.chessriot.gg/path";
    globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = "a".repeat(32);
    globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__ = "b".repeat(32);

    expect(configuredAppOrigin()).toBeNull();
    expect(controlOrigin()).toBe("https://control.chessriot.gg");
    expect(runtimeReadiness()).toMatchObject({
      core: false,
      configuration: { appOrigin: false, controlOrigin: false },
    });
  });

  it("uses only an exact configured HTTPS origin for hosted links", () => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_APP_ORIGIN__ = "https://dev.chessriot.gg";

    expect(applicationOrigin(new Request("https://legacy.example/app")))
      .toBe("https://dev.chessriot.gg");
  });

  it("keeps hosted OpenAI and Google credentials isolated by environment", () => {
    globalThis.__CHESSRIOT_OPENAI_API_KEY__ = "legacy-key";
    globalThis.__CHESSRIOT_OPENAI_API_KEY_DEV__ = "dev-key";
    globalThis.__CHESSRIOT_OPENAI_API_KEY_PROD__ = "prod-key";
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_DEV__ = "dev-client";
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_PROD__ = "prod-client";

    globalThis.__CHESSRIOT_ENV__ = "development";
    expect(openAiApiKey()).toBe("dev-key");
    expect(googleClientId()).toBe("dev-client");

    globalThis.__CHESSRIOT_ENV__ = "production";
    expect(openAiApiKey()).toBe("prod-key");
    expect(googleClientId()).toBe("prod-client");

    globalThis.__CHESSRIOT_ENV__ = "local";
    expect(openAiApiKey()).toBe("legacy-key");
    expect(googleClientId()).toBeNull();
  });
});
