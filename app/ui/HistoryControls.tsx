"use client";

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
  return (
    <div className="history-controls" dir="ltr" role="group" aria-label="היסטוריית מהלכים">
      <button
        type="button"
        aria-label="העמדה הקודמת"
        title="העמדה הקודמת"
        disabled={unavailable || (currentPly === 0 && !canStepBackFromDraft)}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        aria-label="העמדה הבאה"
        title="העמדה הבאה"
        disabled={unavailable || !viewingHistory}
        onClick={onForward}
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
