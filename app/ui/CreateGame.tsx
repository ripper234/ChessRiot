"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  AiDifficulty,
  GameMode,
  GameSnapshot,
  TurnPaceDays,
} from "@/lib/game-types";
import {
  canUseGameStorage,
  generateSecret,
  generateUuid,
  inviteKey,
  playerKey,
  privateGamePath,
  rememberGame,
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

interface AccountGame {
  id: string;
  mode: GameMode;
  status: "waiting" | "active" | "completed";
  color: "w" | "b";
  opponent: string | null;
  turn: "w" | "b";
  plyCount: number;
  updatedAt: string;
  outcome: {
    winner: "w" | "b" | null;
    reason: string;
  } | null;
}

interface AccountGamesPage {
  games?: AccountGame[];
  nextCursor?: string | null;
}

function gameState(game: AccountGame): {
  label: string;
  tone: "ready" | "waiting" | "won" | "lost" | "draw";
} {
  if (game.status === "waiting") {
    return { label: "Waiting for opponent", tone: "waiting" };
  }
  if (game.status === "active") {
    return game.turn === game.color
      ? { label: "Your turn", tone: "ready" }
      : { label: "Opponent’s turn", tone: "waiting" };
  }
  if (!game.outcome?.winner) return { label: "Draw", tone: "draw" };
  return game.outcome.winner === game.color
    ? { label: "You won", tone: "won" }
    : { label: "You lost", tone: "lost" };
}

export function CreateGame({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>("multiplayer");
  const [difficulty, setDifficulty] = useState<AiDifficulty>(3);
  const [turnPaceDays, setTurnPaceDays] = useState<TurnPaceDays>(3);
  const [games, setGames] = useState<AccountGame[]>([]);
  const [nextGamesCursor, setNextGamesCursor] = useState<string | null>(null);
  const [gamesBusy, setGamesBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<PendingCreate | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/games?limit=12", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(`/verify?return_to=${encodeURIComponent("/")}`);
          return null;
        }
        return response.ok ? await response.json() as AccountGamesPage : null;
      })
      .then((data) => {
        if (cancelled || !data?.games) return;
        setGames(data.games);
        setNextGamesCursor(data.nextCursor ?? null);
      })
      .catch(() => {
        // Starting a game stays available if the history panel cannot load.
      });
    return () => { cancelled = true; };
  }, []);

  async function loadMoreGames() {
    if (!nextGamesCursor || gamesBusy) return;
    setGamesBusy(true);
    try {
      const response = await fetch(
        `/api/me/games?limit=12&cursor=${encodeURIComponent(nextGamesCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = await response.json() as AccountGamesPage;
      if (!data.games) return;
      setGames((current) => {
        const known = new Set(current.map((game) => game.id));
        return [...current, ...data.games!.filter((game) => !known.has(game.id))];
      });
      setNextGamesCursor(data.nextCursor ?? null);
    } catch {
      // The player can retry without affecting game creation or existing links.
    } finally {
      setGamesBusy(false);
    }
  }

  async function createGame(event: FormEvent) {
    event.preventDefault();
    if (!canUseGameStorage()) {
      setError("Allow browser storage so the opening animation and invitation can be restored.");
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
          mode,
          ...(mode === "solo" ? { difficulty } : {}),
          ...(mode === "multiplayer" ? { turnPaceDays } : {}),
          ...pending.current,
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        inviteUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !data.game || (mode === "multiplayer" && !data.inviteUrl)) {
        if (response.status === 401) {
          window.location.assign(`/verify?return_to=${encodeURIComponent("/")}`);
          return;
        }
        throw new Error(data.error?.message ?? "Could not create the game");
      }
      localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
      if (data.inviteUrl) localStorage.setItem(inviteKey(data.game.id), data.inviteUrl);
      if (
        data.game.mode === "solo"
        && data.game.you.color === "b"
        && data.game.plyCount > 0
      ) {
        sessionStorage.setItem(`chessriot:opening-intro:${data.game.id}`, "1");
      }
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
        <div className="topbar-actions">
          <span className="account-name">{displayName}</span>
          <Link className="home-link" href="/changelog">WHAT&apos;S NEW</Link>
          <a className="home-link" href="/signout-with-chatgpt?return_to=%2F">SWITCH ACCOUNT</a>
        </div>
      </header>
      <section className="start-stage">
        <form className="voxel-card create-card" onSubmit={createGame}>
          <span className="card-kicker">NEW GAME</span>
          <h1>Play chess</h1>
          <p className="signed-in-note">Playing as <strong>{displayName}</strong></p>
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
          ) : (
            <fieldset className="pace-fieldset" disabled={busy}>
              <legend>Time per move</legend>
              <div className="pace-options">
                {([1, 3, 5] as TurnPaceDays[]).map((days) => (
                  <label className={turnPaceDays === days ? "selected" : ""} key={days}>
                    <input
                      type="radio"
                      name="turn-pace"
                      value={days}
                      checked={turnPaceDays === days}
                      onChange={() => {
                        setTurnPaceDays(days);
                        pending.current = null;
                      }}
                    />
                    <strong>{days}</strong>
                    <small>{days === 1 ? "DAY" : "DAYS"}</small>
                  </label>
                ))}
              </div>
              <p>Missing the deadline ends the game. Three days is the default.</p>
            </fieldset>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={busy}>
            {busy
              ? "STARTING…"
              : mode === "solo" ? "PLAY RIOT BOT  →" : "CREATE GAME  →"}
          </button>
        </form>
      </section>
      {games.length > 0 ? (
        <section className="recent-section">
          <div className="section-title"><span>MY GAMES</span><i /></div>
          <div className="recent-grid">
            {games.map((game) => {
              const state = gameState(game);
              return (
                <Link className="recent-card" href={`/g/${game.id}`} key={game.id}>
                  <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}>
                    ♟
                  </span>
                  <span>
                    <strong>{game.opponent ?? "Waiting for opponent"}</strong>
                    <span className="game-state" data-tone={state.tone}>{state.label}</span>
                    <small>
                      {game.mode === "solo" ? "SOLO" : "MULTIPLAYER"}
                      {" · "}
                      {game.color === "w" ? "WHITE" : "BLACK"}
                    </small>
                  </span>
                  <b>→</b>
                </Link>
              );
            })}
          </div>
          {nextGamesCursor ? (
            <button
              className="secondary-button load-more-games"
              type="button"
              disabled={gamesBusy}
              onClick={() => void loadMoreGames()}
            >
              {gamesBusy ? "LOADING…" : "LOAD MORE GAMES"}
            </button>
          ) : null}
        </section>
      ) : null}
      <footer>
        CHESSRIOT v{APP_VERSION} <span>•</span> <Link href="/changelog">CHANGELOG</Link>
        <span>•</span> <a href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer">GITHUB</a>
      </footer>
    </main>
  );
}
