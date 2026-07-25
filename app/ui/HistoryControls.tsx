"use client";

interface HistoryControlsProps {
  currentPly: number;
  latestPly: number;
  viewingHistory: boolean;
  unavailable?: boolean;
  onBack(): void;
  onForward(): void;
  onLive(): void;
}

export function HistoryControls({
  currentPly,
  latestPly,
  viewingHistory,
  unavailable = false,
  onBack,
  onForward,
  onLive,
}: HistoryControlsProps) {
  return (
    <div className="history-controls" role="group" aria-label="Move history">
      <button
        type="button"
        aria-label="Previous position"
        title="Previous position"
        disabled={unavailable || currentPly === 0}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        className="history-live"
        aria-label={viewingHistory ? "Return to live position" : "Live position"}
        disabled={!viewingHistory}
        onClick={onLive}
      >
        {unavailable
          ? "HISTORY OFF"
          : viewingHistory
            ? `${currentPly}/${latestPly} · GO LIVE`
            : "LIVE"}
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
