"use client";

import { useLanguage } from "./LanguageProvider";


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
  const { locale, dir, t } = useLanguage();
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
    <div className={`turn-deadline${yourTurn ? " mine" : ""}`} lang={locale} dir={dir} role="timer" aria-live="off">
      <span aria-hidden="true">⌛</span>
      <div>
        <small>{yourTurn ? t("Your move deadline") : t("Opponent's move deadline")}</small>
        <strong>{formatTurnTimeLeft(deadlineAt, now, locale)}</strong>
      </div>
      <b>{turnPaceDays} {t(turnPaceDays === 1 ? "day" : "days")}{" "}{t("/ move")}</b>
    </div>
  );
}
