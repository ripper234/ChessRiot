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
    <div className="history-controls" role="group" aria-label="Move history">
      <button
        type="button"
        aria-label="Previous position"
        title="Previous position"
        disabled={unavailable || (currentPly === 0 && !canStepBackFromDraft)}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        aria-label="Next position"
        title="Next position"
        disabled={unavailable || !viewingHistory}
        onClick={onForward}
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
