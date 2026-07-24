"use client";

import { FormEvent, useRef, useState } from "react";
import { generateUuid } from "@/lib/client-storage";

export function FeedbackButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function open() {
    setMessage("");
    dialog.current?.showModal();
  }

  function close() {
    if (!busy) dialog.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          comment: comment.trim() || null,
          page: window.location.pathname,
          requestId: generateUuid(),
        }),
      });
      if (!response.ok) throw new Error("submit_failed");
      setTitle("");
      setComment("");
      setMessage("Thanks. Your feedback is in the pool.");
    } catch {
      setMessage("Could not submit yet. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="feedback-launcher" type="button" onClick={open}>
        FEEDBACK
      </button>
      <dialog
        className="feedback-dialog"
        ref={dialog}
        aria-labelledby="feedback-title"
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form onSubmit={submit}>
          <span className="card-kicker">HELP SHAPE CHESSRIOT</span>
          <h2 id="feedback-title">Send feedback</h2>
          <label htmlFor="feedback-summary">Title</label>
          <input
            id="feedback-summary"
            value={title}
            maxLength={120}
            required
            autoFocus
            placeholder="What should change?"
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="feedback-comment">Comment <span>optional</span></label>
          <textarea
            id="feedback-comment"
            value={comment}
            maxLength={2_000}
            rows={4}
            placeholder="A little more context"
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
          {message ? <p className="feedback-message" role="status">{message}</p> : null}
          <div className="feedback-actions">
            <button type="button" className="feedback-cancel" onClick={close} disabled={busy}>CLOSE</button>
            <button className="primary-button" disabled={busy || !title.trim()}>
              {busy ? "SENDING…" : "SUBMIT"}
            </button>
          </div>
          <a
            className="contribute-link"
            href="https://github.com/ripper234/ChessRiot/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Advanced: view issues or send a pull request on GitHub ↗
          </a>
        </form>
      </dialog>
    </>
  );
}
