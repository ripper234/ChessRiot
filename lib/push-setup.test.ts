import { describe, expect, it } from "vitest";
import {
  PushSetupError,
  pushSetupHttpError,
  pushSetupRecoveryMessage,
  pushSetupTelemetryCode,
  runPushSetupStage,
} from "./push-setup";

describe("push setup diagnostics", () => {
  it("preserves the browser stage and a bounded DOMException class", async () => {
    const failure = runPushSetupStage("subscription_create", async () => {
      throw new DOMException("provider text must not escape", "AbortError");
    });
    await expect(failure).rejects.toEqual(expect.objectContaining({
      stage: "subscription_create",
      kind: "aborted",
    }));
    await expect(failure).rejects.not.toHaveProperty("message", "provider text must not escape");
  });

  it("uses Brave guidance only for browser subscription creation", () => {
    const subscribe = new PushSetupError("subscription_create", "aborted");
    expect(pushSetupRecoveryMessage(subscribe, true)).toContain(
      "Use Google services for push messaging",
    );
    expect(pushSetupRecoveryMessage(subscribe, false)).not.toContain("Brave");

    const server = new PushSetupError("server_register", "unavailable");
    expect(pushSetupRecoveryMessage(server, true)).toContain("could not save this device");
    expect(pushSetupRecoveryMessage(server, true)).not.toContain("Brave");
  });

  it("separates invalid app keys, session changes, and rate limits", () => {
    expect(pushSetupRecoveryMessage(
      new PushSetupError("subscription_create", "invalid_key"),
      true,
    )).toContain("ChessRiot configuration problem");
    expect(pushSetupRecoveryMessage(pushSetupHttpError("server_register", 409), false))
      .toContain("session changed");
    expect(pushSetupRecoveryMessage(pushSetupHttpError("server_register", 429), false))
      .toContain("Too many");
  });

  it("returns native Hebrew recovery copy when requested", () => {
    expect(pushSetupRecoveryMessage(
      new PushSetupError("server_register", "network"),
      false,
      "he",
    )).toContain("לא הצליח לשמור את המכשיר");
  });

  it("emits only an enumerated privacy-safe diagnostic code", () => {
    expect(pushSetupTelemetryCode(
      "manual",
      new PushSetupError("subscription_create", "aborted"),
    )).toBe("push_manual_subscription_create_aborted");
    expect(pushSetupTelemetryCode(
      "reconcile",
      pushSetupHttpError("server_status", 503),
    )).toBe("push_reconcile_server_status_unavailable");
  });
});
