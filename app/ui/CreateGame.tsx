"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AiDifficulty, GameMode, GameSnapshot } from "@/lib/game-types";
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

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  1: "Easy",
  2: "Relaxed",
  3: "Medium",
  4: "Tough",
  5: "Brutal",
};

export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("multiplayer");
  const [difficulty, setDifficulty] = useState<AiDifficulty>(3);
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
        body: JSON.stringify({
          displayName: cleanName,
          mode,
          ...(mode === "solo" ? { difficulty } : {}),
          ...pending.current,
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        inviteUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !data.game || (mode === "multiplayer" && !data.inviteUrl)) {
        throw new Error(data.error?.message ?? "Could not create the game");
      }
      localStorage.setItem("chessriot:displayName", cleanName);
      localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
      if (data.inviteUrl) localStorage.setItem(inviteKey(data.game.id), data.inviteUrl);
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
      <header className="topbar">
        <Brand />
        <Link className="home-link" href="/changelog">WHAT&apos;S NEW</Link>
      </header>
      <section className="start-stage">
        <form className="voxel-card create-card" onSubmit={createGame}>
          <span className="card-kicker">NEW GAME</span>
          <h1>Play chess</h1>
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
          <fieldset className="mode-fieldset" disabled={busy}>
            <legend>Game mode</legend>
            <div className="mode-options">
              <label className={mode === "solo" ? "selected" : ""}>
                <input
                  type="radio"
                  name="game-mode"
                  value="solo"
                  checked={mode === "solo"}
                  onChange={() => {
                    setMode("solo");
                    pending.current = null;
                  }}
                />
                <span aria-hidden="true">◆</span>
                <strong>SOLO</strong>
                <small>You vs Riot Bot</small>
              </label>
              <label className={mode === "multiplayer" ? "selected" : ""}>
                <input
                  type="radio"
                  name="game-mode"
                  value="multiplayer"
                  checked={mode === "multiplayer"}
                  onChange={() => {
                    setMode("multiplayer");
                    pending.current = null;
                  }}
                />
                <span aria-hidden="true">⚔</span>
                <strong>MULTIPLAYER</strong>
                <small>Challenge a friend</small>
              </label>
            </div>
          </fieldset>
          {mode === "solo" ? (
            <div className="difficulty-control">
              <div className="difficulty-heading">
                <label htmlFor="computer-level">Riot Bot level</label>
                <output htmlFor="computer-level">Level {difficulty} · {DIFFICULTY_LABELS[difficulty]}</output>
              </div>
              <input
                id="computer-level"
                type="range"
                min="1"
                max="5"
                step="1"
                value={difficulty}
                aria-valuetext={`Level ${difficulty} of 5, ${DIFFICULTY_LABELS[difficulty]}`}
                onChange={(event) => {
                  setDifficulty(Number(event.target.value) as AiDifficulty);
                  pending.current = null;
                }}
                disabled={busy}
              />
              <div className="difficulty-scale" aria-hidden="true"><span>LOWER</span><span>HIGHER</span></div>
            </div>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={busy || !name.trim()}>
            {busy
              ? "STARTING…"
              : mode === "solo" ? "PLAY RIOT BOT  →" : "CREATE GAME  →"}
          </button>
        </form>
      </section>
      {recent.length > 0 ? (
        <section className="recent-section">
          <div className="section-title"><span>CONTINUE A MATCH</span><i /></div>
          <div className="recent-grid">
            {recent.map((game) => (
              <Link className="recent-card" href={`/g/${game.id}`} key={game.id}>
                <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}>
                  ♟
                </span>
                <span><strong>{game.label}</strong><small>Tap to return</small></span>
                <b>→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <footer>
        CHESSRIOT v{APP_VERSION} <span>•</span> <Link href="/changelog">CHANGELOG</Link>
        <span>•</span> <a href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer">GITHUB</a>
      </footer>
    </main>
  );
}
