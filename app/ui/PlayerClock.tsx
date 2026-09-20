"use client";

import { useEffect, useState } from "react";
import type { Color, GameSnapshot } from "@/lib/game-types";

export function formattedElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function liveElapsedTime(
  game: GameSnapshot,
  color: Color,
  elapsedSinceSnapshotMs: number,
): number {
  const measured = game.elapsedMs[color];
  if (game.status !== "active" || game.turn !== color || !game.turnStartedAt) return measured;
  return measured + Math.max(0, elapsedSinceSnapshotMs);
}

export function PlayerClock({ game, color }: { game: GameSnapshot; color: Color }) {
  const [elapsedSinceSnapshotMs, setElapsedSinceSnapshotMs] = useState(0);
  const visible = game.turnPaceDays == null;
  const active = visible && game.status === "active" && game.turn === color;

  useEffect(() => {
    setElapsedSinceSnapshotMs(0);
    if (!active) return;
    const startedAt = performance.now();
    let timer: number | null = null;
    const update = () => {
      setElapsedSinceSnapshotMs(Math.max(0, performance.now() - startedAt));
    };
    const start = () => {
      if (document.visibilityState !== "visible" || timer !== null) return;
      update();
      timer = window.setInterval(update, 1_000);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, game.clockAsOf, game.version]);

  if (!visible) return null;

  const formatted = formattedElapsedTime(
    liveElapsedTime(game, color, elapsedSinceSnapshotMs),
  );
  return (
    <span
      className="player-clock"
      dir="ltr"
      data-active={active ? "true" : "false"}
      aria-label={`הזמן שחלף לשחקן ${color === "w" ? "לבן" : "שחור"}: ${formatted}${active ? ", השעון פועל" : ""}`}
    >
      <small dir="rtl">{active ? "חושב" : "חלף"}</small>
      <strong>{formatted}</strong>
    </span>
  );
}
