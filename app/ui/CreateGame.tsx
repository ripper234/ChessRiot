"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/game-types";
import {
  canUseGameStorage,
  generateSecret,
  generateUuid,
  inviteKey,
  playerKey,
  privateGamePath,
  readRecentGames,
  rememberGame,
  type RecentGame,
} from "@/lib/client-storage";
import { APP_VERSION } from "@/lib/version";
import { Brand } from "./Brand";

interface PendingCreate {
  playerToken: string;
  inviteToken: string;
  requestId: string;
}

export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<PendingCreate | null>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem("chessriot:displayName") ?? "");
    } catch {
      setName("");
    }
    setRecent(readRecentGames());
  }, []);

  async function createGame(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    if (!canUseGameStorage()) {
      setError("Allow browser storage to keep your private game seat.");
      return;
    }
    setBusy(true);
    setError("");
    pending.current ??= {
      playerToken: generateSecret(),
      inviteToken: generateSecret(),
      requestId: generateUuid(),
    };
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: cleanName, ...pending.current }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        inviteUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !data.game || !data.inviteUrl) {
        throw new Error(data.error?.message ?? "Could not create the game");
      }
      localStorage.setItem("chessriot:displayName", cleanName);
      localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
      localStorage.setItem(inviteKey(data.game.id), data.inviteUrl);
      rememberGame(data.game);
      router.push(privateGamePath(data.game.id, pending.current.playerToken));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-shell">
      <header className="topbar"><Brand /><span className="top-tag">ASYNC&nbsp;&nbsp;//&nbsp;&nbsp;2 PLAYERS</span></header>
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow"><span /> REAL CHESS. TOTAL PLAY.</p>
          <h1>MOVE BOLDLY.<br /><em>WIN BRIGHTLY.</em></h1>
          <p className="hero-text">Start a game, send one link, and keep playing whenever you both have time.</p>
          <div className="feature-row" aria-label="Game features">
            <span>♜ LEGAL CHESS</span><span>◇ SAVES EVERY MOVE</span><span>⌁ PHONE READY</span>
          </div>
        </div>
        <form className="voxel-card create-card" onSubmit={createGame}>
          <span className="card-kicker">NEW MATCH</span>
          <h2>Enter the arena</h2>
          <label htmlFor="display-name">Your display name</label>
          <input
            id="display-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              pending.current = null;
            }}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Ron"
            disabled={busy}
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={busy || !name.trim()}>
            {busy ? "BUILDING BOARD…" : "CREATE GAME  →"}
          </button>
          <p className="fine-print">No account. Your private game link works across your devices.</p>
        </form>
      </section>
      {recent.length > 0 ? (
        <section className="recent-section">
          <div className="section-title"><span>CONTINUE A MATCH</span><i /></div>
          <div className="recent-grid">
            {recent.map((game) => (
              <Link className="recent-card" href={`/g/${game.id}`} key={game.id}>
                <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}>
                  {game.color === "w" ? "♙" : "♟"}
                </span>
                <span><strong>{game.label}</strong><small>Tap to return</small></span>
                <b>→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <footer>CHESSRIOT v{APP_VERSION} <span>•</span> MADE FOR FAMILY RIVALS</footer>
    </main>
  );
}
