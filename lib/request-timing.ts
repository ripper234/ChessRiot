/** Fixed, numeric request stages. Never put player or game data in this header. */
const TIMING_STAGES = [
  "schema", "cookie", "upsert", "profile", "feature", "authorize",
  "deadline", "bot", "world", "moves", "snapshot",
] as const;

export type TimingStage = typeof TIMING_STAGES[number];
const MAX_DURATION_MS = 120_000;
const stageNames = new Set<string>(TIMING_STAGES);

function boundedDuration(value: number): number {
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)));
}

export function createRequestTiming() {
  const stages = new Map<TimingStage, number>();
  return {
    async measure<T>(stage: TimingStage, operation: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        return await operation();
      } finally {
        stages.set(stage, boundedDuration(performance.now() - started));
      }
    },
    measureSync<T>(stage: TimingStage, operation: () => T): T {
      const started = performance.now();
      try {
        return operation();
      } finally {
        stages.set(stage, boundedDuration(performance.now() - started));
      }
    },
    apply(response: Response): Response {
      response.headers.set("server-timing", [...stages]
        .map(([stage, duration]) => `${stage};dur=${duration}`)
        .join(", "));
      return response;
    },
  };
}

/** The central observer accepts only the stages emitted by game/session reads. */
export function observedRequestTimings(response: Response): Record<string, number> {
  const metadata: Record<string, number> = {};
  const header = response.headers.get("server-timing") ?? "";
  if (header.length > 512) return metadata;
  for (const metric of header.split(",")) {
    const match = /^\s*([a-z]+);dur=(\d{1,6})\s*$/.exec(metric);
    if (!match || !stageNames.has(match[1])) continue;
    const duration = Number(match[2]);
    if (duration > MAX_DURATION_MS) continue;
    metadata[`${match[1]}Ms`] = duration;
  }
  return metadata;
}
