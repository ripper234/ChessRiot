"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PlayerHandle } from "./PlayerHandle";

const CATEGORIES = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["inappropriate_username", "Inappropriate username"],
  ["cheating", "Suspected cheating"],
  ["other", "Other"],
] as const;

export function PlayerSafetyDialog({
  username,
  canRemove,
  onClose,
  onChanged,
}: {
  username: string;
  canRemove: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function removeFriend() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/friends", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error();
      onChanged();
      onClose();
    } catch {
      setError(true);
      setMessage("This friend could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!confirmBlock) {
      setConfirmBlock(true);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/blocks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const payload = await response.json() as { error?: { message?: unknown } };
      if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "Block failed");
      onChanged();
      onClose();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "This player could not be blocked.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(event: FormEvent | null, blockAfter: boolean) {
    event?.preventDefault();
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/me/reports", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, category, note, block: blockAfter }),
      });
      const payload = await response.json() as {
        blocked?: boolean;
        blockError?: unknown;
        error?: { message?: unknown };
      };
      if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "Report failed");
      if (blockAfter && payload.blocked !== true) {
        throw new Error(
          typeof payload.blockError === "string"
            ? `Report sent, but blocking failed: ${payload.blockError}`
            : "Report sent, but this player could not be blocked.",
        );
      }
      onChanged();
      setMessage(blockAfter ? "Report sent and player blocked." : "Report sent. Thank you.");
      if (blockAfter) onClose();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "This report could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog className="safety-dialog" ref={dialogRef} aria-labelledby="safety-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="safety-card">
        <header><div><p>PLAYER SAFETY</p><h2 id="safety-dialog-title"><PlayerHandle username={username} /></h2></div><button type="button" onClick={onClose} aria-label="Close player safety">×</button></header>
        <div className="safety-account-actions">
          {canRemove ? <button type="button" disabled={busy} onClick={() => void removeFriend()}>REMOVE FRIEND</button> : null}
          <button className={confirmBlock ? "danger-button" : ""} type="button" disabled={busy} onClick={() => void block()}>
            {confirmBlock ? "CONFIRM BLOCK" : "BLOCK PLAYER"}
          </button>
          {confirmBlock ? <small>Blocking removes the connection and cancels waiting challenges between you.</small> : null}
        </div>
        <form onSubmit={(event) => void submitReport(event, false)}>
          <h3>Report this player</h3>
          <label htmlFor="safety-category">REASON</label>
          <select id="safety-category" value={category} disabled={busy} onChange={(event) => setCategory(event.target.value as typeof category)}>
            {CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <label htmlFor="safety-note">OPTIONAL DETAILS</label>
          <textarea id="safety-note" value={note} maxLength={280} rows={4} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          <small>{note.length}/280. Reports are visible only to ChessRiot administrators.</small>
          <div><button type="submit" disabled={busy}>SEND REPORT</button><button type="button" disabled={busy} onClick={() => void submitReport(null, true)}>REPORT &amp; BLOCK</button></div>
        </form>
        {message ? <p className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{message}</p> : null}
      </section>
    </dialog>
  );
}
