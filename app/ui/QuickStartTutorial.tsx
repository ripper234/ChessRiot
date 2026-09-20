"use client";

import { useEffect, useRef, useState } from "react";
import { reportProductEvent } from "@/lib/client-telemetry";
import {
  completeTutorialMove,
  INITIAL_TUTORIAL_PRACTICE,
  moveTutorialKnight,
  previousTutorialStep,
  selectTutorialKnight,
  TUTORIAL_DESTINATIONS,
} from "@/lib/tutorial-practice";
import { ChessPiece } from "./ChessPiece";

const STEPS = [
  {
    eyebrow: "1 OF 3 · FIND THE MOVE",
    title: "Tap a piece.",
    body: "Legal destinations light up. Tap the knight below to continue.",
  },
  {
    eyebrow: "2 OF 3 · PLAY IT",
    title: "Tap a glowing square.",
    body: "ChessRiot checks the move, saves it instantly, and hands the turn over.",
  },
  {
    eyebrow: "3 OF 3 · COME BACK ANYTIME",
    title: "Your games wait for you.",
    body: "Activity shows challenges, turns, and results. History keeps every finished game.",
  },
] as const;

export function QuickStartTutorial({
  onDone,
}: {
  onDone: (status: "completed" | "skipped") => void;
}) {
  const [practice, setPractice] = useState(INITIAL_TUTORIAL_PRACTICE);
  const { step, selected, movedTo } = practice;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    reportProductEvent("tutorial.started");
    dialogRef.current?.showModal();
    titleRef.current?.focus({ preventScroll: true });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => {
      preference.removeEventListener("change", update);
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  async function finish(status: "completed" | "skipped"): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/me/tutorial", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: status === "completed" ? "complete" : "skip" }),
      });
      if (!response.ok) throw new Error();
      reportProductEvent(status === "completed" ? "tutorial.completed" : "tutorial.skipped");
      onDone(status);
      return true;
    } catch {
      setError("Your tutorial choice could not be saved. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function finishAndGo(path: string) {
    if (await finish("completed")) window.location.assign(path);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setPractice((current) => ({
        ...current,
        step: (current.step + 1) as 1 | 2,
      }));
      return;
    }
    void finish("completed");
  }

  return (
    <dialog
      className="tutorial-dialog"
      ref={dialogRef}
      aria-labelledby="tutorial-title"
      aria-describedby="tutorial-step-status tutorial-description"
      onCancel={(event) => {
        event.preventDefault();
        void finish("skipped");
      }}
    >
      <section className="tutorial-card">
        <header>
          <div>
            <p>{STEPS[step].eyebrow}</p>
            <h2 id="tutorial-title" ref={titleRef} tabIndex={-1}>{STEPS[step].title}</h2>
          </div>
          <button type="button" disabled={saving} onClick={() => void finish("skipped")}>SKIP</button>
        </header>

        {step < 2 ? (
          <div className="tutorial-board" data-selected={selected} data-moved={Boolean(movedTo)} aria-label="Practice board">
            {Array.from({ length: 64 }, (_, index) => (
              <span className="tutorial-square" key={index} aria-hidden="true" />
            ))}
            <button
              className="tutorial-piece tutorial-knight"
              type="button"
              aria-label="White knight"
              disabled={saving || movedTo !== null}
              style={movedTo ? {
                gridColumn: TUTORIAL_DESTINATIONS.find((item) => item.square === movedTo)?.column,
                gridRow: TUTORIAL_DESTINATIONS.find((item) => item.square === movedTo)?.row,
              } : undefined}
              onClick={() => setPractice(selectTutorialKnight)}
            >
              <ChessPiece type="n" color="w" />
            </button>
            {movedTo !== "c3" ? (
              <span className="tutorial-piece tutorial-target-piece" aria-hidden="true">
                <ChessPiece type="p" color="b" />
              </span>
            ) : null}
            {TUTORIAL_DESTINATIONS.map(({ square, column, row }) => (
              <button
                type="button"
                className="tutorial-target"
                aria-label={`Move knight to ${square}`}
                key={square}
                style={{ gridColumn: column, gridRow: row }}
                disabled={step !== 1 || saving || movedTo !== null}
                onClick={() => {
                  setPractice((current) => moveTutorialKnight(current, square));
                  if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
                  if (reducedMotion) setPractice(completeTutorialMove);
                  else advanceTimer.current = window.setTimeout(() => {
                    advanceTimer.current = null;
                    setPractice(completeTutorialMove);
                  }, 350);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="tutorial-inbox-preview" aria-label="Activity preview">
            <div><span>♞</span><p><strong>Your turn</strong><small>Play your move against @Omri.</small></p><b>PLAY</b></div>
            <div><span>⚔</span><p><strong>New challenge</strong><small>@Dana challenged you.</small></p><b>OPEN</b></div>
            <div><span>✓</span><p><strong>Game finished</strong><small>You won. Review the moves anytime.</small></p><b>REVIEW</b></div>
          </div>
        )}

        <p className="sr-only" id="tutorial-step-status" role="status" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="tutorial-copy" id="tutorial-description">{STEPS[step].body}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="tutorial-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, index) => <span data-active={index <= step} key={index} />)}
        </div>
        <footer>
          {step ? <button className="quiet-button" type="button" disabled={saving} onClick={() => {
            if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
            advanceTimer.current = null;
            setPractice(previousTutorialStep);
          }}>BACK</button> : <span />}
          {step === STEPS.length - 1 ? (
            <div>
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void finishAndGo("/")}>GO HOME</button>
              <button className="primary-button" type="button" disabled={saving} onClick={() => void finishAndGo("/app")}>START A GAME</button>
            </div>
          ) : (
            <button className="primary-button" type="button" disabled={saving || (step === 0 && !selected) || (step === 1 && !movedTo)} onClick={next}>{step === 0 && !selected ? "SELECT THE KNIGHT" : step === 1 && !movedTo ? "MAKE THE MOVE" : "NEXT"}</button>
          )}
        </footer>
      </section>
    </dialog>
  );
}
