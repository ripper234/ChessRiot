import assert from "node:assert/strict";
export async function verifyAccountPreferences({ createRuntime, request, body, accountForLabel, usernameForAccount }) {
  const runtime = createRuntime({ databaseName: "account-preferences-e2e" });
  try {
    const a = accountForLabel("Language English"), b = accountForLabel("Language Hebrew");
    const call = (who, method = "GET", data, headers) => request(runtime, method === "GET" ? "/api/auth/session" : "/api/me/preferences", {
      accountEmail: who.email, accountName: who.displayName, method,
      ...(data ? { body: JSON.stringify(data) } : {}), ...(headers ? { headers } : {}),
    });
    assert.equal((await body(await call(a))).account.locale, "en");
    assert.equal((await body(await call(b))).account.locale, "en");
    assert.equal((await call(b, "PATCH", { locale: "he", expectedUsername: usernameForAccount(b) })).status, 200);
    assert.equal((await body(await call(a))).account.locale, "en");
    assert.equal((await body(await call(b))).account.locale, "he");
    assert.equal((await call(a, "PATCH", { locale: "he", expectedUsername: usernameForAccount(b) })).status, 409);
    assert.equal((await call(a, "PATCH", { locale: ["he"], expectedUsername: usernameForAccount(a) })).status, 400);
    assert.equal((await call(a, "PATCH", { locale: "fr", expectedUsername: usernameForAccount(a) })).status, 400);
    assert.equal((await call(a, "PATCH", { locale: "he", accountId: "other", expectedUsername: usernameForAccount(a) })).status, 400);
    assert.equal((await call(a, "PATCH", { locale: "he", expectedUsername: usernameForAccount(a) }, { origin: "https://other.test" })).status, 403);
    console.log("E2E passed: independent saved account languages, account-switch guard, input validation and same-origin protection");
  } finally { await runtime.dispose(); }
}
