import type {
  Color,
  GameClockSnapshot,
  GameMode,
  StoredMove,
} from "./game-types";

type ClockMove = Pick<StoredMove, "color" | "createdAt">;

export interface GameClockSource {
  mode: GameMode;
  status: "waiting" | "active" | "completed";
  turn: Color;
  createdAt: string;
  joinedAt: string | null;
  finishedAt: string | null;
  moves: ClockMove[];
}

function timestampMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNowMs(nowMs: number): number {
  return Number.isFinite(nowMs) ? nowMs : Date.now();
}

function asIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function latestRecordedMoveMs(moves: ClockMove[], startMs: number): number {
  let latest = startMs;
  for (const move of moves) {
    const moveMs = timestampMs(move.createdAt);
    if (moveMs !== null) latest = Math.max(latest, moveMs);
  }
  return latest;
}

/**
 * Reconstructs cumulative chess clocks from immutable game events.
 *
 * Active snapshots include the open turn through `clockAsOf`. Consumers can
 * keep that clock moving by adding time since `clockAsOf` only to `turn`.
 */
export function gameClockSnapshot(
  source: GameClockSource,
  nowMs = Date.now(),
): GameClockSnapshot {
  const measuredNowMs = safeNowMs(nowMs);
  const empty = { w: 0, b: 0 } satisfies Record<Color, number>;

  if (source.status === "waiting") {
    return {
      elapsedMs: empty,
      turnStartedAt: null,
      clockAsOf: asIso(measuredNowMs),
    };
  }

  const startMs = source.mode === "solo"
    ? timestampMs(source.createdAt)
    : timestampMs(source.joinedAt);

  // A multiplayer game has no authoritative clock start until it is joined.
  // Completed legacy/cancelled waiting games therefore remain at zero.
  if (startMs === null) {
    const clockAsOfMs = source.status === "completed"
      ? timestampMs(source.finishedAt)
        ?? timestampMs(source.createdAt)
        ?? measuredNowMs
      : measuredNowMs;
    return {
      elapsedMs: empty,
      turnStartedAt: null,
      clockAsOf: asIso(clockAsOfMs),
    };
  }

  const endMs = source.status === "completed"
    ? Math.max(
      startMs,
      timestampMs(source.finishedAt)
        ?? latestRecordedMoveMs(source.moves, startMs),
    )
    : Math.max(startMs, measuredNowMs);
  const elapsedMs: Record<Color, number> = { w: 0, b: 0 };
  let cursorMs = startMs;

  for (const move of source.moves) {
    const recordedMoveMs = timestampMs(move.createdAt) ?? cursorMs;
    const moveMs = Math.min(endMs, Math.max(cursorMs, recordedMoveMs));
    elapsedMs[move.color] += moveMs - cursorMs;
    cursorMs = moveMs;
  }

  elapsedMs[source.turn] += endMs - cursorMs;

  return {
    elapsedMs,
    turnStartedAt: source.status === "active" ? asIso(cursorMs) : null,
    clockAsOf: asIso(endMs),
  };
}
