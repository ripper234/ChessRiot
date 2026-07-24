"use client";

import { Chess, type PieceSymbol, type Square } from "chess.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildReplayFrames,
  replayFrameLabel,
} from "@/lib/game-replay";
import { isDarkSquare } from "@/lib/game-presentation";
import type { Color, PublicMove } from "@/lib/game-types";

const PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

interface ReplayViewerProps {
  moves: PublicMove[];
  orientation: Color;
}

export function ReplayViewer({ moves, orientation }: ReplayViewerProps) {
  const launcher = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [requestedFrame, setRequestedFrame] = useState(0);
  const replay = useMemo(() => {
    try {
      return { frames: buildReplayFrames(moves), error: false };
    } catch {
      return { frames: buildReplayFrames([]), error: true };
    }
  }, [moves]);
  const frameIndex = Math.min(requestedFrame, replay.frames.length - 1);
  const frame = replay.frames[frameIndex];
  const chess = useMemo(() => new Chess(frame.fen), [frame.fen]);
  const squares = useMemo(() => {
    if (orientation === "w") {
      return RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}` as Square));
    }
    return [...RANKS].reverse().flatMap((rank) =>
      [...FILES].reverse().map((file) => `${file}${rank}` as Square),
    );
  }, [orientation]);

  useEffect(() => {
    if (!open || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
  }, [open]);

  function showReplay() {
    setRequestedFrame(replay.frames.length - 1);
    setOpen(true);
  }

  function closeReplay() {
    if (dialog.current?.open) dialog.current.close();
    else setOpen(false);
  }

  function finishClosing() {
    setOpen(false);
    window.requestAnimationFrame(() => launcher.current?.focus());
  }

  function moveTo(next: number) {
    setRequestedFrame(Math.max(0, Math.min(next, replay.frames.length - 1)));
  }

  return (
    <section className="side-card replay-card">
      <div className="side-heading">
        <h2>GAME REPLAY</h2>
        <span>{moves.length} PLY</span>
      </div>
      <p>Step through the complete game without changing live play.</p>
      <button
        className="replay-launch"
        type="button"
        ref={launcher}
        disabled={replay.error}
        onClick={showReplay}
      >
        {moves.length ? "REPLAY MOVES" : "VIEW START POSITION"}
      </button>
      {replay.error ? <p className="replay-error" role="status">Replay is unavailable for this game history.</p> : null}

      <dialog
        className="replay-dialog"
        ref={dialog}
        aria-labelledby="game-replay-title"
        onClose={finishClosing}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTo(frameIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTo(frameIndex + 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            moveTo(0);
          } else if (event.key === "End") {
            event.preventDefault();
            moveTo(replay.frames.length - 1);
          }
        }}
      >
        <div className="replay-dialog-shell">
          <header className="replay-dialog-header">
            <div>
              <small>READ-ONLY HISTORY</small>
              <h2 id="game-replay-title">GAME REPLAY</h2>
            </div>
            <button type="button" onClick={closeReplay} aria-label="Return to live game">×</button>
          </header>

          <div className="replay-position" role="status" aria-live="polite" aria-atomic="true">
            <strong>{frame.ply === 0 ? "START" : `MOVE ${frame.moveNumber}`}</strong>
            <span>{replayFrameLabel(frame)}</span>
            <small>{frame.ply} OF {moves.length} PLY</small>
          </div>

          <div className="replay-board-frame">
            <div
              className="replay-board"
              role="grid"
              aria-label={`Historical chess board, ${replayFrameLabel(frame)}`}
            >
              {squares.map((square, index) => {
                const piece = chess.get(square);
                const isLast = frame.from === square || frame.to === square;
                const showRank = index % 8 === 0;
                const showFile = index >= 56;
                return (
                  <div
                    className={`replay-square ${isDarkSquare(square) ? "dark-square" : "light-square"}${isLast ? " replay-last" : ""}`}
                    role="gridcell"
                    aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}` : " empty"}`}
                    key={square}
                  >
                    {showRank ? <span className="replay-rank">{square[1]}</span> : null}
                    {showFile ? <span className="replay-file">{square[0]}</span> : null}
                    {piece ? (
                      <span className={`replay-piece piece-${piece.color}`} aria-hidden="true">
                        {PIECES[piece.color][piece.type]}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="replay-controls" aria-label="Replay navigation">
            <button type="button" disabled={frameIndex === 0} onClick={() => moveTo(0)}>
              <span aria-hidden="true">|◀</span> START
            </button>
            <button type="button" disabled={frameIndex === 0} onClick={() => moveTo(frameIndex - 1)}>
              <span aria-hidden="true">◀</span> BACK
            </button>
            <button
              type="button"
              disabled={frameIndex === replay.frames.length - 1}
              onClick={() => moveTo(frameIndex + 1)}
            >
              NEXT <span aria-hidden="true">▶</span>
            </button>
            <button
              type="button"
              disabled={frameIndex === replay.frames.length - 1}
              onClick={() => moveTo(replay.frames.length - 1)}
            >
              END <span aria-hidden="true">▶|</span>
            </button>
          </div>
          <button className="replay-live" type="button" onClick={closeReplay}>
            RETURN TO LIVE PLAY
          </button>
          <p className="replay-key-help">Keyboard: ← previous, → next, Home start, End latest, Esc live.</p>
        </div>
      </dialog>
    </section>
  );
}
