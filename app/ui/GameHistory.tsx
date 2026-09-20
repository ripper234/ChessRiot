"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAME_VARIANTS,
  gameVariant,
  normalizeGameVariantId,
  type GameVariantId,
} from "@/lib/game-variants";
import type { TurnPaceDays } from "@/lib/game-types";
import { isTurnPaceDays } from "@/lib/validation";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";

type ModeFilter = "all" | "solo" | "multiplayer";
type MagicFilter = "all" | "yes" | "no";

interface HistoryGame {
  id: string;
  mode: "solo" | "multiplayer";
  variantId: GameVariantId;
  status: "waiting" | "active" | "completed";
  color: "w" | "b";
  opponent: string | null;
  turn: "w" | "b";
  turnPaceDays: TurnPaceDays | null;
  plyCount: number;
  isMagic: boolean;
  updatedAt: string;
  outcome: { winner: "w" | "b" | null; reason: string } | null;
}

function parseGames(value: unknown): HistoryGame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): HistoryGame[] => {
    if (!row || typeof row !== "object") return [];
    const game = row as Record<string, unknown>;
    if (
      typeof game.id !== "string"
      || (game.mode !== "solo" && game.mode !== "multiplayer")
      || (game.status !== "waiting" && game.status !== "active" && game.status !== "completed")
      || (game.color !== "w" && game.color !== "b")
      || (game.turn !== "w" && game.turn !== "b")
      || typeof game.plyCount !== "number"
      || typeof game.updatedAt !== "string"
    ) return [];
    const outcome = game.outcome && typeof game.outcome === "object"
      ? game.outcome as { winner?: unknown; reason?: unknown }
      : null;
    return [{
      id: game.id,
      mode: game.mode,
      variantId: normalizeGameVariantId(game.variantId),
      status: game.status,
      color: game.color,
      opponent: typeof game.opponent === "string" ? game.opponent : null,
      turn: game.turn,
      turnPaceDays: isTurnPaceDays(game.turnPaceDays) ? game.turnPaceDays : null,
      plyCount: game.plyCount,
      isMagic: game.isMagic === true,
      updatedAt: game.updatedAt,
      outcome: outcome && typeof outcome.reason === "string"
        && (outcome.winner === "w" || outcome.winner === "b" || outcome.winner === null)
        ? { winner: outcome.winner, reason: outcome.reason }
        : null,
    }];
  });
}

function resultLabel(game: HistoryGame): string {
  if (game.status === "waiting") return "Waiting for acceptance";
  if (game.status === "active") return game.turn === game.color ? "Your turn" : "Their turn";
  if (game.outcome?.reason === "cancelled") return "Cancelled";
  if (!game.outcome || game.outcome.winner === null) return "Draw";
  return game.outcome.winner === game.color ? "Won" : "Lost";
}

export function GameHistory() {
  const [mode, setMode] = useState<ModeFilter>("all");
  const [variantId, setVariantId] = useState<"all" | GameVariantId>("all");
  const [magic, setMagic] = useState<MagicFilter>("all");
  const [games, setGames] = useState<HistoryGame[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadSequence = useRef(0);

  const load = useCallback(async (append: boolean, nextCursor?: string | null) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    const search = new URLSearchParams({
      limit: "24",
      mode,
      variant: variantId,
      magic,
    });
    if (nextCursor) search.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/me/games?${search}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json() as {
        games?: unknown;
        nextCursor?: unknown;
        error?: { message?: unknown };
      };
      if (!response.ok) throw new Error(typeof payload.error?.message === "string"
        ? payload.error.message
        : "History could not be loaded.");
      if (sequence !== loadSequence.current) return;
      const next = parseGames(payload.games);
      setGames((current) => append ? [...current, ...next] : next);
      setCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(caught instanceof Error ? caught.message : "History could not be loaded.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [magic, mode, variantId]);

  useEffect(() => { void load(false); }, [load]);

  return (
    <main className="history-shell">
      <header className="topbar history-topbar"><Brand /><Link href="/">HOME</Link></header>
      <section className="history-stage">
        <header className="history-heading"><div><p>YOUR ACCOUNT</p><h1>Game history</h1></div><Link className="primary-button" href="/app">NEW GAME</Link></header>
        <div className="history-filters" aria-label="Filter game history">
          <fieldset><legend>MODE</legend>{(["all", "solo", "multiplayer"] as ModeFilter[]).map((value) => (
            <label data-selected={mode === value} key={value}><input type="radio" name="history-mode" checked={mode === value} onChange={() => setMode(value)} />{value === "all" ? "All" : value === "solo" ? "Solo" : "Multiplayer"}</label>
          ))}</fieldset>
          <label><span>GAME TYPE</span><select value={variantId} onChange={(event) => setVariantId(event.target.value as "all" | GameVariantId)}>
            <option value="all">All games</option>{GAME_VARIANTS.map((variant) => <option value={variant.id} key={variant.id}>{variant.name}</option>)}
          </select></label>
          <label><span>RULES</span><select value={magic} onChange={(event) => setMagic(event.target.value as MagicFilter)}>
            <option value="all">All rules</option><option value="yes">Magic only</option><option value="no">Normal only</option>
          </select></label>
        </div>
        {error ? <div className="history-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load(false)}>TRY AGAIN</button></div> : null}
        {!error && !loading && !games.length ? <div className="history-empty"><span>♟</span><h2>No games match</h2><p>Try a broader filter or start a new match.</p></div> : null}
        {games.length ? <div className="history-list">{games.map((game) => (
          <Link href={`/g/${game.id}`} className="history-game" key={game.id}>
            <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}><ChessPiece type="p" color={game.color} /></span>
            <span className="history-game-main"><strong>{game.mode === "solo" ? "Riot Bot" : game.opponent ? `@${game.opponent}` : "Open invitation"}</strong><small>{gameVariant(game.variantId).name}{game.isMagic ? " · Magic" : ""}{game.mode === "multiplayer" && game.turnPaceDays ? ` · ${game.turnPaceDays} ${game.turnPaceDays === 1 ? "day" : "days"}/move` : ""} · {game.plyCount} {game.plyCount === 1 ? "move" : "moves"}</small></span>
            <span className="history-game-meta"><b data-result={resultLabel(game).toLowerCase().replace(/\s/g, "-")}>{resultLabel(game)}</b><small>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(game.updatedAt))}</small></span>
            <i aria-hidden="true">→</i>
          </Link>
        ))}</div> : null}
        {loading ? <p className="history-loading" role="status">LOADING GAMES…</p> : null}
        {cursor && !loading ? <button className="history-more" type="button" onClick={() => void load(true, cursor)}>LOAD MORE</button> : null}
      </section>
    </main>
  );
}
