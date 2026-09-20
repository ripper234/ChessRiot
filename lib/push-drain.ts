export interface PushDrainResult {
  attempted: number;
  failed: number;
  hasMore?: boolean;
  /** Earliest durable row eligibility, including any active claim lease. */
  nextAttemptAt?: number | null;
}

export type PushDrain = (limit?: number) => Promise<PushDrainResult>;

export const REQUEST_PUSH_WAKE_DELAYS_MS = [2_100, 15_100] as const;
export const REQUEST_PUSH_RETRY_START_BUDGET_MS = 25_000;
export const REQUEST_PUSH_ROUND_RESERVE_MS = 5_500;
export const REQUEST_PUSH_ROUND_LIMIT = 1;
export const REQUEST_PUSH_FINAL_ROUND_LIMIT = REQUEST_PUSH_ROUND_LIMIT;

export type PushDrainLane = "turn" | "account";

interface PushDrainPolicyOptions {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onLaneError?: (lane: PushDrainLane, error: unknown) => void;
}

const sleepFor = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

function canStartRound(
  startedAt: number,
  delayMs: number,
  now: () => number,
): boolean {
  return now() - startedAt + delayMs + REQUEST_PUSH_ROUND_RESERVE_MS
    <= REQUEST_PUSH_RETRY_START_BUDGET_MS;
}

interface LaneRoundResult {
  failed: boolean;
  hasMore: boolean;
  nextAttemptAt?: number | null;
}

async function drainLane(
  lane: PushDrainLane,
  drain: PushDrain,
  onLaneError?: PushDrainPolicyOptions["onLaneError"],
): Promise<LaneRoundResult> {
  try {
    const result = await drain(REQUEST_PUSH_ROUND_LIMIT);
    return {
      failed: result.failed > 0,
      hasMore: result.hasMore === true,
      nextAttemptAt: result.nextAttemptAt,
    };
  } catch (error) {
    try {
      onLaneError?.(lane, error);
    } catch {
      // Observability cannot couple otherwise independent delivery lanes.
    }
    return { failed: true, hasMore: false };
  }
}

interface LaneState {
  name: PushDrainLane;
  drain: PushDrain;
  hasMore: boolean;
  retryAt: number | null;
  retryIndex: number;
}

export async function runBoundedPushDrain(
  drainTurns: PushDrain,
  drainAccounts: PushDrain,
  options: PushDrainPolicyOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const startedAt = now();
  const lanes: LaneState[] = [
    { name: "turn", drain: drainTurns, hasMore: true, retryAt: null, retryIndex: 0 },
    { name: "account", drain: drainAccounts, hasMore: true, retryAt: null, retryIndex: 0 },
  ];

  // Bound rounds as well as elapsed time: a contended database may report due
  // rows without claiming one, and fake/low-resolution clocks need not advance.
  for (let round = 0; round < 32; round += 1) {
    const nextWake = Math.min(...lanes.map((lane) => lane.hasMore
      ? now()
      : lane.retryAt ?? Infinity));
    if (!Number.isFinite(nextWake)) return;
    const delay = Math.max(0, nextWake - now());
    if (round > 0 && !canStartRound(startedAt, delay, now)) return;
    if (delay > 0) await sleep(delay);
    if (round > 0 && !canStartRound(startedAt, 0, now)) return;

    const dueAt = now();
    await Promise.all(lanes.map(async (lane) => {
      const retryDue = lane.retryAt !== null && lane.retryAt <= dueAt;
      if (!lane.hasMore && !retryDue) return;
      if (retryDue) lane.retryAt = null;
      const result = await drainLane(lane.name, lane.drain, options.onLaneError);
      lane.hasMore = result.hasMore;
      if (result.nextAttemptAt !== undefined) {
        lane.retryAt = result.nextAttemptAt;
      } else if (result.failed && lane.retryAt === null) {
        const retryDelay = REQUEST_PUSH_WAKE_DELAYS_MS[lane.retryIndex];
        if (retryDelay !== undefined) {
          lane.retryAt = now() + retryDelay;
          lane.retryIndex += 1;
        }
      }
      // A successful *different* device must not erase an earlier failure's
      // wake. Conversely, a future retry must never delay currently due rows.
    }));
  }
}
