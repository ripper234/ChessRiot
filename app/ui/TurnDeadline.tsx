"use client";

import { useEffect, useState } from "react";
import { formatTurnTimeLeft } from "@/lib/game-deadlines";
import type { TurnPaceDays } from "@/lib/game-types";

export function TurnDeadline({
  deadlineAt,
  turnPaceDays,
  yourTurn,
}: {
  deadlineAt: string;
  turnPaceDays: TurnPaceDays;
  yourTurn: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`turn-deadline${yourTurn ? " mine" : ""}`} role="timer" aria-live="off">
      <span aria-hidden="true">⌛</span>
      <div>
        <small>{yourTurn ? "YOUR MOVE DEADLINE" : "OPPONENT MOVE DEADLINE"}</small>
        <strong>{formatTurnTimeLeft(deadlineAt, now)}</strong>
      </div>
      <b>{turnPaceDays} {turnPaceDays === 1 ? "DAY" : "DAYS"} / MOVE</b>
    </div>
  );
}
