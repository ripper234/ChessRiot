"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { publishAuthSessionChanged } from "@/lib/auth-session-client";
import { normalizedUsername } from "@/lib/usernames";
import { useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";
import { PlayerHandle } from "./PlayerHandle";

function blockedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && typeof (entry as { username?: unknown }).username === "string") {
      return [(entry as { username: string }).username];
    }
    return [];
  });
}

export function PrivacyCenter() {
  const account = useAccountSession();
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [confirmation, setConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function loadBlocked() {
    setBlockedLoading(true);
    try {
      const response = await fetch("/api/me/blocks", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { blocked?: unknown };
      setBlocked(blockedNames(payload.blocked));
    } catch {
      setError(true);
      setMessage("Blocked players could not be loaded.");
    } finally {
      setBlockedLoading(false);
    }
  }

  useEffect(() => { void loadBlocked(); }, []);

  async function unblock(username: string) {
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/me/blocks", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error();
      setBlocked((current) => current.filter((name) => name !== username));
      setMessage(`@${username} is no longer blocked.`);
    } catch {
      setError(true);
      setMessage(`@${username} could not be unblocked.`);
    }
  }

  async function deleteAccount() {
    if (normalizedUsername(confirmation) !== normalizedUsername(account.username)) {
      setError(true);
      setMessage(`Type ${account.username} exactly to confirm.`);
      return;
    }
    setDeleteBusy(true);
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/me/account", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: confirmation }),
      });
      const payload = await response.json() as { error?: { code?: unknown; message?: unknown } };
      if (!response.ok) {
        if (payload.error?.code === "recent_auth_required") {
          setMessage("Verify with Google, then return here to finish deletion.");
        } else {
          setMessage(typeof payload.error?.message === "string"
            ? payload.error.message
            : "Your account could not be deleted.");
        }
        setError(true);
        return;
      }
      publishAuthSessionChanged(false);
      window.location.assign("/?account_deleted=1");
    } catch {
      setError(true);
      setMessage("Your account could not be deleted. Check your connection and try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <main className="privacy-center-shell">
      <header className="topbar privacy-center-topbar">
        <Brand />
        <Link className="home-link" href="/">BACK HOME</Link>
      </header>
      <section className="privacy-center-heading">
        <div><p>ACCOUNT CONTROL</p><h1>Privacy &amp; Data</h1></div>
        <PlayerHandle username={account.username} />
      </section>
      <section className="privacy-center-grid">
        <article className="privacy-center-card">
          <span className="privacy-center-icon" aria-hidden="true">⇩</span>
          <div><p>YOUR COPY</p><h2>Download your data</h2></div>
          <p>Get a readable JSON file with your profile, friends, complete game and move history, referrals, and reports. Private credentials and security hashes are excluded.</p>
          <a className="primary-button" href="/api/me/export" download>DOWNLOAD DATA</a>
        </article>

        <article className="privacy-center-card">
          <span className="privacy-center-icon" aria-hidden="true">⊘</span>
          <div><p>PLAYER SAFETY</p><h2>Blocked players</h2></div>
          {blockedLoading ? <p role="status">Loading blocked players...</p> : blocked.length ? (
            <ul className="blocked-player-list">{blocked.map((username) => (
              <li key={username}><PlayerHandle username={username} /><button type="button" onClick={() => void unblock(username)}>UNBLOCK</button></li>
            ))}</ul>
          ) : <p>No blocked players.</p>}
        </article>

        <article className="privacy-center-card privacy-delete-card">
          <span className="privacy-center-icon" aria-hidden="true">!</span>
          <div><p>PERMANENT ACTION</p><h2>Delete your account</h2></div>
          <p>This removes your profile, friends, active access, referral data, and game membership. Finished boards remain only as anonymized game records. Your username stays reserved so nobody can impersonate the deleted account.</p>
          <a className="secondary-button" href="/api/auth/google/start?return_to=%2Fprivacy-center%3Fdelete%3D1&amp;reauth=1">VERIFY WITH GOOGLE</a>
          <label htmlFor="delete-account-confirmation">TYPE <strong>{account.username}</strong> TO CONFIRM</label>
          <input
            id="delete-account-confirmation"
            value={confirmation}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { setConfirmation(event.target.value); setMessage(""); setError(false); }}
          />
          <button className="danger-button" type="button" disabled={deleteBusy || !confirmation.trim()} onClick={() => void deleteAccount()}>
            {deleteBusy ? "DELETING..." : "DELETE ACCOUNT PERMANENTLY"}
          </button>
        </article>
      </section>
      {message ? <p className={`privacy-center-message ${error ? "form-error" : "form-success"}`} role={error ? "alert" : "status"}>{message}</p> : null}
      <p className="privacy-center-policy">Learn how data is handled in the <Link href="/privacy">Privacy Policy</Link>.</p>
    </main>
  );
}
