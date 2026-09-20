export interface PushDrainResult {
  attempted: number;
  failed: number;
  hasMore?: boolean;
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

async function drainAvailableRows(
  drainTurns: PushDrain,
  drainAccounts: PushDrain,
  turns: boolean,
  accounts: boolean,
  startedAt: number,
  now: () => number,
  onLaneError?: PushDrainPolicyOptions["onLaneError"],
): Promise<{
  turnsFailed: boolean;
  accountsFailed: boolean;
  turnsHaveMore: boolean;
  accountsHaveMore: boolean;
}> {
  let activeTurns = turns;
  let activeAccounts = accounts;
  let turnsFailed = false;
  let accountsFailed = false;
  let first = true;

  while (
    (activeTurns || activeAccounts)
    && (first || canStartRound(startedAt, 0, now))
  ) {
    first = false;
    const [turnResult, accountResult] = await Promise.all([
      activeTurns
        ? drainLane("turn", drainTurns, onLaneError)
        : Promise.resolve({ failed: false, hasMore: false }),
      activeAccounts
        ? drainLane("account", drainAccounts, onLaneError)
        : Promise.resolve({ failed: false, hasMore: false }),
    ]);
    turnsFailed ||= activeTurns && turnResult.failed;
    accountsFailed ||= activeAccounts && accountResult.failed;
    activeTurns = activeTurns && turnResult.hasMore;
    activeAccounts = activeAccounts && accountResult.hasMore;
    if (turnResult.failed || accountResult.failed) break;
  }

  return {
    turnsFailed,
    accountsFailed,
    turnsHaveMore: activeTurns,
    accountsHaveMore: activeAccounts,
  };
}

export async function runBoundedPushDrain(
  drainTurns: PushDrain,
  drainAccounts: PushDrain,
  options: PushDrainPolicyOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const startedAt = now();
  let round = await drainAvailableRows(
    drainTurns,
    drainAccounts,
    true,
    true,
    startedAt,
    now,
    options.onLaneError,
  );

  for (let retry = 0; retry < REQUEST_PUSH_WAKE_DELAYS_MS.length; retry += 1) {
    const retryTurns = round.turnsFailed;
    const retryAccounts = round.accountsFailed;
    if (!retryTurns && !retryAccounts) return;

    const delayMs = REQUEST_PUSH_WAKE_DELAYS_MS[retry];
    if (!canStartRound(startedAt, delayMs, now)) return;
    await sleep(delayMs);
    if (!canStartRound(startedAt, 0, now)) return;

    round = await drainAvailableRows(
      drainTurns,
      drainAccounts,
      retryTurns || round.turnsHaveMore,
      retryAccounts || round.accountsHaveMore,
      startedAt,
      now,
      options.onLaneError,
    );
  }
}
