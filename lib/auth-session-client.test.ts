import { beforeEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("./client-recovery", () => ({ fetchJsonWithReadTimeout: read }));
import { publishAuthSessionInvalidated, readAuthSession } from "./auth-session-client";
import { prefetchGame, takeGamePrefetch } from "./game-prefetch";
const result = (name: string) => ({ response: new Response("{}"), data: { game: { you: { name } } } });
beforeEach(() => { vi.stubGlobal("window", { dispatchEvent: vi.fn() }); publishAuthSessionInvalidated(); read.mockReset(); });
describe("account-scoped startup reads", () => {
  it("deduplicates concurrent session reads and the immediate settings refresh", async () => {
    read.mockResolvedValue(result("a"));
    await Promise.all([readAuthSession(), readAuthSession(), readAuthSession()]);
    await readAuthSession();
    expect(read).toHaveBeenCalledTimes(1);
    publishAuthSessionInvalidated();
    await readAuthSession();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not deliver an old session after invalidation, even if it rejects", async () => {
    let reject!: (error: Error) => void;
    read.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const old = readAuthSession();
    publishAuthSessionInvalidated();
    read.mockResolvedValue(result("b"));
    const current = await readAuthSession();
    reject(new Error("old request failed"));
    expect(await old).toBe(current);
  });
  it("discards an already-consumed prefetch after account invalidation", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    read.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    prefetchGame("game");
    const consumed = takeGamePrefetch("game", "a");
    publishAuthSessionInvalidated();
    resolve(result("a"));
    expect(await consumed).toBeNull();
  });
  it("checks the authenticated username before using a cold game response", async () => {
    read.mockResolvedValue(result("a"));
    prefetchGame("game");
    expect(await takeGamePrefetch("game", "b")).toBeNull();
    prefetchGame("game");
    expect((await takeGamePrefetch("game", "a"))?.data?.game?.you.name).toBe("a");
  });
});
