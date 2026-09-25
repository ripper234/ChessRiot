export function listenForGameTurnPush(
  serviceWorker: ServiceWorkerContainer,
  gameId: string,
  currentVersion: () => number,
  refresh: (sinceVersion: number) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type !== "chessriot:game-updated"
      || data.gameId !== gameId
      || !Number.isSafeInteger(data.gameVersion)
      || data.gameVersion <= currentVersion()) return;
    refresh(currentVersion());
  };
  serviceWorker.addEventListener("message", onMessage);
  return () => serviceWorker.removeEventListener("message", onMessage);
}
