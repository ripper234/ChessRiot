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
import {
  clearRequiredTextError,
  requiredTextError,
} from "@/lib/form-validation";
import { DIFFICULTY_LABELS } from "@/lib/game-presentation";
import {
  gameVariant,
  type GameVariantId,
} from "@/lib/game-variants";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";
import { GameVariantPicker } from "./GameVariantPicker";
import { RequiredTextInput } from "./RequiredTextInput";

export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("solo");
  const [variantId, setVariantId] = useState<GameVariantId>("standard");
  const [difficulty, setDifficulty] = useState<AiDifficulty>(3);
  const [turnPaceDays, setTurnPaceDays] = useState<TurnPaceDays>(3);
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const pending = useRef<PendingGameCreate | null>(null);
  const selectedVariant = gameVariant(variantId);

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
    const missingName = requiredTextError(
      name,
      "Enter your display name to start a game.",
    );
    if (missingName) {
      setError("");
      setNameError(missingName);
      window.requestAnimationFrame(() => nameInput.current?.focus());
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
        body: JSON.stringify(gameCreatePayload({
          displayName: cleanName,
          guestToken: guestIdentityToken(),
          mode,
          variantId,
          difficulty,
          turnPaceDays,
          pending: pending.current,
        })),
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
      </header>
      <section className="start-stage">
        <form className="voxel-card create-card" onSubmit={createGame} noValidate>
          <span className="card-kicker">NEW GAME</span>
          <h1>Play chess</h1>
          <RequiredTextInput
            ref={nameInput}
            id="display-name"
            label="Your display name"
            value={name}
            error={nameError}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              setNameError((current) => clearRequiredTextError(nextName, current));
              pending.current = null;
            }}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Ron"
            disabled={busy}
          />
          <GameVariantPicker
            value={variantId}
            disabled={busy}
            onChange={(nextVariantId) => {
              setVariantId(nextVariantId);
              if (gameVariant(nextVariantId).soloOnly) setMode("solo");
              pending.current = null;
            }}
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
              <label
                className={`${mode === "multiplayer" ? "selected" : ""}${selectedVariant.soloOnly ? " disabled" : ""}`}
                aria-disabled={selectedVariant.soloOnly}
              >
                <input
                  type="radio"
                  name="game-mode"
                  value="multiplayer"
                  checked={mode === "multiplayer"}
                  disabled={selectedVariant.soloOnly}
                  onChange={() => {
                    setMode("multiplayer");
                    pending.current = null;
                  }}
                />
                <span aria-hidden="true">⚔</span>
                <strong>MULTIPLAYER</strong>
                <small>{selectedVariant.soloOnly ? "Not available for training" : "Challenge a friend"}</small>
              </label>
            </div>
          </fieldset>
          {variantId === "standard" ? <div className="magic-box coming-soon">
            <div className="magic-toggle">
              <span aria-hidden="true">✦</span>
              <div>
                <strong>MAGIC RULES</strong>
                <small>Optional rules for future games</small>
              </div>
              <b>SOON</b>
            </div>
            <div className="magic-coming-soon" role="status">
              <strong>COMING SOON</strong>
              <p>Magic Rules are being developed safely on a separate preview branch.</p>
            </div>
          </div> : (
            <div className="variant-fixed-rules">
              <span aria-hidden="true">{selectedVariant.icon}</span>
              <div>
                <strong>{selectedVariant.name.toUpperCase()}</strong>
                <small>{selectedVariant.group === "mating-set"
                  ? "Solo practice · You command White · Checkmate wins"
                  : "Fixed starting setup · Normal chess moves · Checkmate wins"}</small>
              </div>
            </div>
          )}
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
          <button className="primary-button" type="submit" disabled={busy}>
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
                  <ChessPiece type="p" color={game.color} />
                </span>
                <span><strong>{game.label}</strong><small>
                  {gameVariant(game.variantId).name} · Tap to return
                </small></span>
                <b>→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <footer>
        CHESSRIOT <span>•</span> <Link href="/changelog">CHANGELOG</Link>
        <span>•</span> <a href="https://github.com/ripper234/ChessRiot" target="_blank" rel="noopener noreferrer">GITHUB</a>
      </footer>
    </main>
  );
}
