import { beforeEach, describe, expect, it } from "vitest";
import {
  accountIdForEmail,
  verifiedAccountFromHeaders,
} from "./account-auth";

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

function identityHeaders(email = "player@example.com"): Headers {
  return new Headers({
    [EMAIL_HEADER]: email,
    [NAME_HEADER]: encodeURIComponent("Chess Player"),
    [NAME_ENCODING_HEADER]: "percent-encoded-utf-8",
  });
}

describe("trusted account identity", () => {
  beforeEach(() => {
    globalThis.__CHESSRIOT_ENV__ = "test";
    globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = "account-test-secret";
  });

  it("derives an account from the trusted hosting identity", async () => {
    const id = await accountIdForEmail("PLAYER@example.com");
    expect(id).toBeTruthy();

    await expect(verifiedAccountFromHeaders(identityHeaders())).resolves.toEqual({
      id,
      displayName: "Chess Player",
    });
  });

  it("rejects a request without a trusted hosting identity", async () => {
    await expect(
      verifiedAccountFromHeaders(new Headers()),
    ).resolves.toBeNull();
  });

  it("canonicalizes email identity but keeps accounts isolated", async () => {
    await expect(accountIdForEmail(" Player@Example.com ")).resolves.toBe(
      await accountIdForEmail("player@example.com"),
    );
    await expect(accountIdForEmail("other@example.com")).resolves.not.toBe(
      await accountIdForEmail("player@example.com"),
    );
  });
});
