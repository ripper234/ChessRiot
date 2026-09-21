"use client";

import { useLanguage } from "./LanguageProvider";


interface HistoryControlsProps {
  currentPly: number;
  viewingHistory: boolean;
  unavailable?: boolean;
  canStepBackFromDraft?: boolean;
  onBack(): void;
  onForward(): void;
}

export function HistoryControls({
  currentPly,
  viewingHistory,
  unavailable = false,
  canStepBackFromDraft = false,
  onBack,
  onForward,
}: HistoryControlsProps) {
  const { t } = useLanguage();
  return (
    <div className="history-controls" dir="ltr" role="group" aria-label={t("Move history")}>
      <button
        type="button"
        aria-label={t("Previous position")}
        title={t("Previous position")}
        disabled={unavailable || (currentPly === 0 && !canStepBackFromDraft)}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        aria-label={t("Next position")}
        title={t("Next position")}
        disabled={unavailable || !viewingHistory}
        onClick={onForward}
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
