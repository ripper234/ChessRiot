"use client";

import { type PieceSymbol, type Square } from "chess.js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BoardEffect } from "@/lib/game-effects";
import {
  CHESS_PIECE_NAMES,
  isDarkSquare,
  orientedBoardSquares,
} from "@/lib/game-presentation";
import {
  boardActionDuration,
  BoardActionAnimation,
} from "./BoardActionAnimation";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";

interface AttackSetup {
  from: Square;
  to: Square;
  victim: PieceSymbol;
  label: string;
}

const ATTACKS: Record<PieceSymbol, AttackSetup> = {
  p: { from: "c3", to: "d4", victim: "p", label: "Sword slash" },
  n: { from: "b2", to: "d3", victim: "r", label: "Leap and stomp" },
  b: { from: "b2", to: "e5", victim: "n", label: "Diagonal lance" },
  r: { from: "b4", to: "f4", victim: "b", label: "Ramming charge" },
  q: { from: "b2", to: "f6", victim: "r", label: "Royal sweep" },
  k: { from: "c3", to: "d4", victim: "q", label: "Heavy chop" },
};

const PIECES: PieceSymbol[] = ["p", "n", "b", "r", "q", "k"];

export function CaptureLab() {
  const [piece, setPiece] = useState<PieceSymbol>("p");
  const [running, setRunning] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [run, setRun] = useState(1);
  const squares = useMemo(() => orientedBoardSquares("w"), []);
  const setup = ATTACKS[piece];
  const effect = useMemo<BoardEffect>(() => ({
    id: `capture-lab:${piece}:${run}`,
    ply: run,
    leg: "first",
    from: setup.from,
    to: setup.to,
    capture: true,
    beforeFen: "",
    afterFen: "",
    attacker: { color: "w", type: piece },
    victim: { color: "b", type: setup.victim, square: setup.to },
  }), [piece, run, setup]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setRunning(false),
      boardActionDuration(effect, reducedMotion) + 120,
    );
    return () => window.clearTimeout(timer);
  }, [effect, reducedMotion, running]);

  function play(nextPiece = piece) {
    setPiece(nextPiece);
    setRunning(false);
    window.requestAnimationFrame(() => {
      setRun((current) => current + 1);
      setRunning(true);
    });
  }

  return (
    <main className="capture-lab-shell">
      <header className="topbar capture-lab-topbar">
        <Brand />
        <Link className="home-link" href="/app">PLAY A REAL GAME</Link>
      </header>

      <section className="capture-lab-layout">
        <div className="capture-lab-copy">
          <span className="eyebrow">LIVE COMBAT SYSTEM</span>
          <h1>EVERY PIECE<br /><em>FIGHTS DIFFERENT.</em></h1>
          <p>
            This lab replays the exact decorative layer used in real games.
            The chess position updates instantly underneath it.
          </p>
        </div>

        <div className="capture-lab-stage">
          <div className="capture-lab-heading">
            <div>
              <small>{CHESS_PIECE_NAMES[piece].toUpperCase()}</small>
              <strong>{setup.label}</strong>
            </div>
            <button type="button" onClick={() => play()}>REPLAY ↻</button>
          </div>

          <div
            className="capture-lab-board"
            data-reduced-motion={reducedMotion ? "true" : "false"}
            aria-label={`${CHESS_PIECE_NAMES[piece]} capture animation preview`}
            role="img"
          >
            {squares.map((square) => {
              const showFinalAttacker = !running && square === setup.to;
              return (
                <span
                  className={`capture-lab-square ${isDarkSquare(square) ? "dark-square" : "light-square"}`}
                  key={square}
                >
                  {showFinalAttacker ? (
                    <span className="capture-lab-piece">
                      <ChessPiece type={piece} color="w" />
                    </span>
                  ) : null}
                </span>
              );
            })}
            {running ? (
              <BoardActionAnimation
                key={effect.id}
                effect={effect}
                squares={squares}
                reducedMotion={reducedMotion}
                onComplete={() => setRunning(false)}
              />
            ) : null}
          </div>
          <p className="capture-lab-status" role="status" aria-live="polite">
            {CHESS_PIECE_NAMES[piece]} {setup.label.toLowerCase()} animation{" "}
            {running ? "playing" : "complete"}.
          </p>

          <div className="capture-lab-controls" role="group" aria-label="Choose capture animation">
            {PIECES.map((candidate) => (
              <button
                type="button"
                className={candidate === piece ? "selected" : ""}
                aria-pressed={candidate === piece}
                aria-label={`Preview ${CHESS_PIECE_NAMES[candidate]} capture`}
                key={candidate}
                onClick={() => play(candidate)}
              >
                <ChessPiece type={candidate} color="w" />
                <span>{CHESS_PIECE_NAMES[candidate]}</span>
              </button>
            ))}
          </div>

          <label className="capture-lab-motion">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => {
                setReducedMotion(event.currentTarget.checked);
                play();
              }}
            />
            <span>
              <strong>SIMULATE REDUCED MOTION</strong>
              <small>Immediate final position with one static capture marker.</small>
            </span>
          </label>
        </div>
      </section>
    </main>
  );
}
