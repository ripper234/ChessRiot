"use client";

import { FormEvent, useRef, useState } from "react";
import { generateUuid, guestIdentityToken } from "@/lib/client-storage";
import {
  clearRequiredTextError,
  requiredTextError,
} from "@/lib/form-validation";
import { RequiredTextInput } from "./RequiredTextInput";

export function FeedbackButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [titleError, setTitleError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);

  function open() {
    setMessage("");
    setTitleError("");
    dialog.current?.showModal();
  }

  function close() {
    if (!busy) dialog.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const missingTitle = requiredTextError(
      title,
      "Add a short title before submitting feedback.",
    );
    if (missingTitle) {
      setMessage("");
      setTitleError(missingTitle);
      window.requestAnimationFrame(() => titleInput.current?.focus());
      return;
    }
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
          guestToken: guestIdentityToken(),
        }),
      });
      if (!response.ok) throw new Error("submit_failed");
      setTitle("");
      setComment("");
      setTitleError("");
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
        <form onSubmit={submit} noValidate>
          <span className="card-kicker">HELP SHAPE CHESSRIOT</span>
          <h2 id="feedback-title">Send feedback</h2>
          <RequiredTextInput
            ref={titleInput}
            id="feedback-summary"
            label="Title"
            value={title}
            error={titleError}
            maxLength={120}
            autoFocus
            placeholder="What should change?"
            disabled={busy}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              setTitleError((current) => clearRequiredTextError(nextTitle, current));
            }}
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
            <button className="primary-button" type="submit" disabled={busy}>
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
