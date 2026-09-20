import { describe, expect, it } from "vitest";
import {
  REQUEST_PUSH_FINAL_ROUND_LIMIT,
  REQUEST_PUSH_ROUND_LIMIT,
  REQUEST_PUSH_WAKE_DELAYS_MS,
  runBoundedPushDrain,
  type PushDrain,
} from "./push-drain";

function fakeClock() {
  let elapsedMs = 0;
  const sleeps: number[] = [];
  return {
    advance(delayMs: number) {
      elapsedMs += delayMs;
    },
    now: () => elapsedMs,
    sleeps,
    sleep: async (delayMs: number) => {
      sleeps.push(delayMs);
      elapsedMs += delayMs;
    },
  };
}

describe("bounded request-time push drain", () => {
  it("uses durable retry times after successful unrelated devices and across wakes", async () => {
    const clock = fakeClock();
    const attempts: number[] = [];
    await runBoundedPushDrain(async () => {
      attempts.push(clock.now());
      if (attempts.length === 1) {
        return { attempted: 0, failed: 0, hasMore: false, nextAttemptAt: 1_000 };
      }
      if (attempts.length === 2) {
        return { attempted: 1, failed: 1, hasMore: true, nextAttemptAt: 1_000 };
      }
      if (attempts.length === 3) {
        return { attempted: 1, failed: 0, hasMore: false, nextAttemptAt: 3_000 };
      }
      return { attempted: 1, failed: 0, hasMore: false, nextAttemptAt: null };
    }, async () => ({ attempted: 0, failed: 0, nextAttemptAt: null }), clock);
    expect(attempts).toEqual([0, 1_000, 1_000, 3_000]);
  });

  it("tries healthy devices immediately even when another target times out", async () => {
    const clock = fakeClock();
    const attempts: number[] = [];
    await runBoundedPushDrain(
      async () => {
        attempts.push(clock.now());
        if (attempts.length === 1) {
          clock.advance(5_000);
          return { attempted: 1, failed: 1, hasMore: true };
        }
        return { attempted: 1, failed: 0, hasMore: false };
      },
      async () => ({ attempted: 0, failed: 0 }),
      clock,
    );
    expect(attempts[1]).toBe(5_000);
    expect(attempts).toHaveLength(3);
  });

  it("does not delay a healthy lane behind repeated failures in another lane", async () => {
    const clock = fakeClock();
    const accountAttempts: number[] = [];
    let turns = 0;
    await runBoundedPushDrain(
      async () => {
        turns += 1;
        clock.advance(5_000);
        return { attempted: 1, failed: 1, hasMore: false };
      },
      async () => {
        accountAttempts.push(clock.now());
        return { attempted: 1, failed: 0, hasMore: accountAttempts.length < 3 };
      },
      clock,
    );
    expect(accountAttempts).toHaveLength(3);
    expect(accountAttempts[1]).toBe(5_000);
    expect(turns).toBe(2);
  });

  it("stops after the first successful round", async () => {
    const clock = fakeClock();
    let turnCalls = 0;
    let accountCalls = 0;
    await runBoundedPushDrain(
      async () => {
        turnCalls += 1;
        return { attempted: 1, failed: 0 };
      },
      async () => {
        accountCalls += 1;
        return { attempted: 0, failed: 0 };
      },
      clock,
    );

    expect(turnCalls).toBe(1);
    expect(accountCalls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("retries only failed lanes and caps every provider batch", async () => {
    const clock = fakeClock();
    const turnLimits: Array<number | undefined> = [];
    let accountCalls = 0;
    const drainTurns: PushDrain = async (limit) => {
      turnLimits.push(limit);
      return turnLimits.length < 3
        ? { attempted: 1, failed: 1 }
        : { attempted: 1, failed: 0 };
    };
    await runBoundedPushDrain(
      drainTurns,
      async () => {
        accountCalls += 1;
        return { attempted: 1, failed: 0 };
      },
      clock,
    );

    expect(turnLimits).toEqual([
      REQUEST_PUSH_ROUND_LIMIT,
      REQUEST_PUSH_ROUND_LIMIT,
      REQUEST_PUSH_FINAL_ROUND_LIMIT,
    ]);
    expect(accountCalls).toBe(1);
    expect(clock.sleeps).toEqual([...REQUEST_PUSH_WAKE_DELAYS_MS]);
  });

  it("skips the long retry when earlier drains consume the safety budget", async () => {
    const clock = fakeClock();
    let turnCalls = 0;
    const drainTurns: PushDrain = async () => {
      turnCalls += 1;
      clock.advance(4_000);
      return { attempted: 1, failed: 1 };
    };
    await runBoundedPushDrain(
      drainTurns,
      async () => ({ attempted: 0, failed: 0 }),
      clock,
    );

    expect(turnCalls).toBe(2);
    expect(clock.sleeps).toEqual([REQUEST_PUSH_WAKE_DELAYS_MS[0]]);
  });

  it("continues a healthy due backlog without waiting for another request", async () => {
    const clock = fakeClock();
    let turnCalls = 0;
    await runBoundedPushDrain(
      async (limit) => {
        expect(limit).toBe(REQUEST_PUSH_ROUND_LIMIT);
        turnCalls += 1;
        return {
          attempted: 1,
          failed: 0,
          hasMore: turnCalls < 4,
        };
      },
      async () => ({ attempted: 0, failed: 0, hasMore: false }),
      clock,
    );

    expect(turnCalls).toBe(4);
    expect(clock.sleeps).toEqual([]);
  });

  it("retries a failed lane while continuing a healthy slow backlog", async () => {
    const clock = fakeClock();
    let turnCalls = 0;
    let accountCalls = 0;
    await runBoundedPushDrain(
      async () => {
        turnCalls += 1;
        return turnCalls === 1
          ? { attempted: 1, failed: 1, hasMore: false }
          : { attempted: 1, failed: 0, hasMore: false };
      },
      async () => {
        accountCalls += 1;
        clock.advance(5_000);
        return { attempted: 1, failed: 0, hasMore: accountCalls < 8 };
      },
      clock,
    );

    expect(turnCalls).toBe(2);
    expect(accountCalls).toBeGreaterThan(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("isolates a lane exception and still retries the healthy lane", async () => {
    const clock = fakeClock();
    const failures: string[] = [];
    let turnCalls = 0;
    let accountCalls = 0;
    await runBoundedPushDrain(
      async () => {
        turnCalls += 1;
        return turnCalls === 1
          ? { attempted: 1, failed: 1, hasMore: false }
          : { attempted: 1, failed: 0, hasMore: false };
      },
      async () => {
        accountCalls += 1;
        if (accountCalls === 1) throw new Error("account lane unavailable");
        return { attempted: 0, failed: 0, hasMore: false };
      },
      {
        ...clock,
        onLaneError: (lane) => failures.push(lane),
      },
    );

    expect(turnCalls).toBe(2);
    expect(accountCalls).toBe(2);
    expect(failures).toEqual(["account"]);
    expect(clock.sleeps).toEqual([REQUEST_PUSH_WAKE_DELAYS_MS[0]]);
  });

  it("leaves an unleased backlog for the next wake when the budget is spent", async () => {
    const clock = fakeClock();
    let calls = 0;
    await runBoundedPushDrain(
      async () => {
        calls += 1;
        clock.advance(5_000);
        return { attempted: 1, failed: 0, hasMore: true };
      },
      async () => ({ attempted: 0, failed: 0, hasMore: false }),
      clock,
    );

    expect(calls).toBe(4);
    expect(clock.sleeps).toEqual([]);
  });
});
