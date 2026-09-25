import { describe, expect, it, vi } from "vitest";
import { listenForGameTurnPush } from "./game-push-refresh";

describe("open game turn pushes", () => {
  it("refreshes the matching newer version and removes the listener on exit", () => {
    const gameId = "11111111-1111-4111-8111-111111111111";
    const listeners = new Set<(event: MessageEvent) => void>();
    const serviceWorker = {
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
    } as unknown as ServiceWorkerContainer;
    const refresh = vi.fn();
    let version = 2;
    const stop = listenForGameTurnPush(serviceWorker, gameId, () => version, refresh);
    const send = (data: unknown) => {
      for (const listener of listeners) listener({ data } as MessageEvent);
    };

    send({ type: "chessriot:game-updated", gameId: "22222222-2222-4222-8222-222222222222", gameVersion: 3 });
    send({ type: "chessriot:game-updated", gameId, gameVersion: 2 });
    send({ type: "chessriot:game-updated", gameId, gameVersion: "3" });
    expect(refresh).not.toHaveBeenCalled();

    send({ type: "chessriot:game-updated", gameId, gameVersion: 3 });
    expect(refresh).toHaveBeenCalledExactlyOnceWith(2);
    version = 3;
    send({ type: "chessriot:game-updated", gameId, gameVersion: 3 });
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    send({ type: "chessriot:game-updated", gameId, gameVersion: 4 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
