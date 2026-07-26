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
  guestIdentityToken,
  inviteKey,
  playerKey,
  privateGamePath,
  readRecentGames,
  rememberGame,
  type RecentGame,
} from "@/lib/client-storage";
import {
  gameCreatePayload,
  type PendingGameCreate,
} from "@/lib/game-creation";
import { DIFFICULTY_LABELS } from "@/lib/game-presentation";
import { APP_VERSION } from "@/lib/version";
import {
  MAGIC_PROMPT_MAX_LENGTH,
  normalizeMagicPrompt,
} from "@/lib/magic-rules";
import { Brand } from "./Brand";
import { MagicCompileStatus } from "./MagicCompileStatus";

interface MagicInterpretation {
  prompt: string;
  labels: string[];
  interpretationToken: string;
}

export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("solo");
  const [difficulty, setDifficulty] = useState<AiDifficulty>(3);
  const [turnPaceDays, setTurnPaceDays] = useState<TurnPaceDays>(3);
  const [magicEnabled, setMagicEnabled] = useState(false);
  const [magicPrompt, setMagicPrompt] = useState("");
  const [magicInterpretation, setMagicInterpretation] =
    useState<MagicInterpretation | null>(null);
  const [interpretingMagic, setInterpretingMagic] = useState(false);
  const [magicCompileError, setMagicCompileError] = useState("");
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<PendingGameCreate | null>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem("chessriot:displayName") ?? "");
    } catch {
      setName("");
    }
    setRecent(readRecentGames());
  }, []);

  async function interpretMagic(): Promise<void> {
    const cleanName = name.trim();
    if (!cleanName) {
      setMagicCompileError("Enter your display name before compiling Magic Rules.");
      setError("");
      return;
    }
    const normalized = normalizeMagicPrompt(magicPrompt);
    if (!normalized.ok) {
      setMagicCompileError(normalized.message);
      setError("");
      return;
    }
    setInterpretingMagic(true);
    setError("");
    setMagicCompileError("");
    setMagicInterpretation(null);
    pending.current = null;
    try {
      const response = await fetch("/api/magic-rules/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: cleanName,
          guestToken: guestIdentityToken(),
          prompt: normalized.prompt,
        }),
      });
      const data = (await response.json()) as {
        prompt?: string;
        labels?: string[];
        interpretationToken?: string;
        error?: { message?: string };
      };
      if (
        !response.ok
        || typeof data.prompt !== "string"
        || !Array.isArray(data.labels)
        || typeof data.interpretationToken !== "string"
      ) {
        throw new Error(data.error?.message ?? "Magic could not interpret that rule");
      }
      setMagicInterpretation({
        prompt: data.prompt,
        labels: data.labels,
        interpretationToken: data.interpretationToken,
      });
    } catch (caught) {
      setMagicCompileError(
        caught instanceof Error ? caught.message : "Magic could not compile that rule",
      );
    } finally {
      setInterpretingMagic(false);
    }
  }

  async function createGame(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const normalizedMagic = magicEnabled ? normalizeMagicPrompt(magicPrompt) : null;
    if (magicEnabled && (!normalizedMagic?.ok || magicInterpretation?.prompt !== normalizedMagic.prompt)) {
      setError("Interpret the Magic Rules before creating the game.");
      return;
    }
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
          ...gameCreatePayload({
            displayName: cleanName,
            guestToken: guestIdentityToken(),
            mode,
            difficulty,
            turnPaceDays,
            pending: pending.current,
          }),
          ...(magicEnabled && magicInterpretation
            ? {
                magicPrompt: magicInterpretation.prompt,
                magicInterpretationToken: magicInterpretation.interpretationToken,
              }
            : {}),
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
              setMagicInterpretation(null);
              setMagicCompileError("");
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
          <div className={`magic-box${magicEnabled ? " enabled" : ""}`}>
            <label className="magic-toggle">
              <input
                type="checkbox"
                checked={magicEnabled}
                disabled={busy}
                onChange={(event) => {
                  setMagicEnabled(event.target.checked);
                  setMagicInterpretation(null);
                  setMagicCompileError("");
                  setError("");
                  pending.current = null;
                }}
              />
              <span aria-hidden="true">✦</span>
              <div>
                <strong>MAGIC RULES</strong>
                <small>Optional rules for this game</small>
              </div>
              <b>{magicEnabled ? "ON" : "OFF"}</b>
            </label>
            {magicEnabled ? (
              <div className="magic-prompt">
                <label htmlFor="magic-rule-prompt">Describe the rule</label>
                <textarea
                  id="magic-rule-prompt"
                  value={magicPrompt}
                  maxLength={MAGIC_PROMPT_MAX_LENGTH}
                  rows={3}
                  disabled={busy}
                  placeholder="e.g. “Knights move 3 times.”"
                  onChange={(event) => {
                    setMagicPrompt(event.target.value);
                    setMagicInterpretation(null);
                    setMagicCompileError("");
                    setError("");
                    pending.current = null;
                  }}
                />
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy || interpretingMagic || !name.trim() || !magicPrompt.trim()}
                  onClick={() => void interpretMagic()}
                >
                  COMPILE RULES
                </button>
                <MagicCompileStatus
                  state={
                    interpretingMagic
                      ? "thinking"
                      : magicInterpretation
                        ? "success"
                        : magicCompileError
                          ? "failure"
                          : "idle"
                  }
                  labels={magicInterpretation?.labels}
                  message={magicCompileError}
                />
              </div>
            ) : null}
          </div>
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
          <button className="primary-button" disabled={busy || interpretingMagic || !name.trim()}>
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
                <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}>♟</span>
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
