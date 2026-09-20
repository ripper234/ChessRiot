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
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div className={`turn-deadline${yourTurn ? " mine" : ""}`} dir="rtl" role="timer" aria-live="off">
      <span aria-hidden="true">⌛</span>
      <div>
        <small>{yourTurn ? "המועד האחרון למהלך שלך" : "המועד האחרון למהלך היריב"}</small>
        <strong>{formatTurnTimeLeft(deadlineAt, now, "he")}</strong>
      </div>
      <b>{turnPaceDays} {turnPaceDays === 1 ? "יום" : "ימים"} / מהלך</b>
    </div>
  );
}
