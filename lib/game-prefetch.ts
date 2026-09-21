import { fetchJsonWithReadTimeout } from "./client-recovery";
import type { GameSnapshot } from "./game-types";

let generation = 0;
let pending: { id: string; started: number; promise: ReturnType<typeof fetchJsonWithReadTimeout<{ game?: GameSnapshot; error?: { code?: string } }>> } | null = null;
export function prefetchGame(id: string): void {
  if (pending?.id === id && Date.now() - pending.started < 15_000) return;
  const promise = fetchJsonWithReadTimeout<{ game?: GameSnapshot; error?: { code?: string } }>(`/api/games/${id}`, { cache: "no-store" });
  pending = { id, started: Date.now(), promise };
  // The gate may stay closed; always handle a speculative request rejection.
  void promise.catch(() => undefined);
}
export function clearGamePrefetch(): void { generation += 1; pending = null; }
export async function takeGamePrefetch(id: string, username: string | null) {
  const entry = pending;
  const current = generation;
  pending = null;
  if (!username || entry?.id !== id || Date.now() - entry.started >= 15_000) return null;
  const result = await entry.promise;
  return current === generation && result.data?.game?.you.name === username ? result : null;
}
