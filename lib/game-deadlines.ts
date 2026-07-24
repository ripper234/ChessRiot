import type { TurnPaceDays } from "./game-types";

export function turnWindowMs(turnPaceDays: TurnPaceDays): number {
  return turnPaceDays * 24 * 60 * 60 * 1_000;
}

export function turnDeadlineAt(
  updatedAt: string,
  turnPaceDays: TurnPaceDays,
): string | null {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) return null;
  return new Date(updatedAtMs + turnWindowMs(turnPaceDays)).toISOString();
}

export function turnDeadlineExpired(
  updatedAt: string,
  turnPaceDays: TurnPaceDays,
  nowMs = Date.now(),
): boolean {
  const deadline = turnDeadlineAt(updatedAt, turnPaceDays);
  return deadline !== null && Date.parse(deadline) <= nowMs;
}

export function formatTurnTimeLeft(deadlineAt: string, nowMs = Date.now()): string {
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return "DEADLINE UNAVAILABLE";
  const remainingMs = deadlineMs - nowMs;
  if (remainingMs <= 0) return "TIME EXPIRED";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}M LEFT`;
  const totalHours = Math.ceil(remainingMs / 3_600_000);
  if (totalHours < 24) return `${totalHours}H LEFT`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}D ${hours}H LEFT` : `${days}D LEFT`;
}
