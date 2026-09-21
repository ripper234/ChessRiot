import type { GameSnapshot } from "./game-types";

export const TURN_TEST_CACHE = "chessriot-turn-test-v1";
export const turnTestReceiptPath = (gameId: string, version: number) => `/__chessriot_turn_test__/${gameId}/${version}`;

export interface TurnTestReceipt {
  receivedAt?: number;
  shownAt?: number;
  showRejectedAt?: number;
  clickedAt?: number;
  openedAt?: number;
  confirmedAt?: number;
  visibleClients?: number | null;
  windowClients?: number | null;
}

export function turnTestReceiptOpened(receipt: TurnTestReceipt | undefined): boolean {
  return Boolean(!receipt?.showRejectedAt && receipt?.receivedAt && receipt.shownAt && receipt.clickedAt
    && receipt.openedAt && receipt.visibleClients === 0
    && receipt.receivedAt <= receipt.shownAt && receipt.shownAt <= receipt.clickedAt
    && receipt.clickedAt <= receipt.openedAt);
}

export function turnTestRoundPassed(receipt: TurnTestReceipt | undefined): boolean {
  return Boolean(turnTestReceiptOpened(receipt) && receipt?.confirmedAt
    && receipt.openedAt! <= receipt.confirmedAt);
}

export async function readTurnTestReceipts(gameId: string, version: number, openedGame: boolean): Promise<Record<number, TurnTestReceipt>> {
  const cache = await caches.open(TURN_TEST_CACHE);
  const records: Record<number, TurnTestReceipt> = {};
  for (const roundVersion of [2, 4, 6, 8]) {
    const path = turnTestReceiptPath(gameId, roundVersion);
    const response = await cache.match(path);
    const value: TurnTestReceipt = response ? await response.json() : {};
    if (openedGame && value.clickedAt && !value.openedAt && version >= roundVersion) {
      value.openedAt = Date.now();
      await cache.put(path, new Response(JSON.stringify(value)));
    }
    records[roundVersion] = value;
  }
  return records;
}

export async function confirmTurnTestReceipt(gameId: string, version: number): Promise<void> {
  const cache = await caches.open(TURN_TEST_CACHE);
  const path = turnTestReceiptPath(gameId, version);
  const response = await cache.match(path);
  const value: TurnTestReceipt = response ? await response.json() : {};
  if (!turnTestReceiptOpened(value)) throw new Error("This round is not ready to confirm.");
  await cache.put(path, new Response(JSON.stringify({ ...value, confirmedAt: Date.now() })));
}

export async function clearEndedTurnTestNotification(game: Pick<GameSnapshot, "id" | "status" | "version">): Promise<void> {
  if (game.status !== "completed" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const worker = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.getRegistration())?.active;
    worker?.postMessage({ type: "clear-turn-notification", gameId: game.id, gameVersion: game.version });
  } catch {
    // Notification cleanup must not strand a player in an already-ended test.
  }
}
