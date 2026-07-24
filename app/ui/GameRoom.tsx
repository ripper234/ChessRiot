"use client";

import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { boardEffects, type BoardEffect } from "@/lib/game-effects";
import {
  generateUuid,
  hasSeatTokenInHash,
  inviteKey,
  playerKey,
  privateGamePath,
  privateGameUrl,
  readSeatTokenFromHash,
  rememberGame,
} from "@/lib/client-storage";
import {
  classifyGameSound,
  playGameSound,
  readSoundPreference,
  unlockGameSounds,
  writeSoundPreference,
} from "@/lib/game-sounds";
import {
  capturedPiecesByVictimColor,
  checkedKingSquare as findCheckedKingSquare,
  illegalDestinationMessage,
  isDarkSquare,
  pieceCannotAnswerCheckMessage,
} from "@/lib/game-presentation";
import { shouldAcceptGameSnapshot } from "@/lib/game-snapshots";
import type { DrawClaim, GameSnapshot, Promotion } from "@/lib/game-types";
import { APP_VERSION } from "@/lib/version";
import { Brand } from "./Brand";

const PIECES: Record<"w" | "b", Record<PieceSymbol, string>> = {
  // Filled glyphs let CSS provide unmistakable light and dark piece colors.
  w: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const CONNECTION_MESSAGE = "Connection interrupted. We’ll keep trying.";
const DIFFICULTY_LABELS = ["", "Easy", "Relaxed", "Medium", "Tough", "Brutal"];

interface DragState {
  pointerId: number;
  from: Square;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  over: Square | null;
}

function apiMessage(data: unknown, fallback: string): string {
  if (
    typeof data === "object" && data !== null &&
    typeof (data as { error?: { message?: unknown } }).error?.message === "string"
  ) return (data as { error: { message: string } }).error.message;
  return fallback;
}

function outcomeText(game: GameSnapshot): string {
  if (!game.outcome) return "";
  if (game.outcome.reason === "checkmate") {
    const winner = game.outcome.winner === "w" ? game.players.white.name : game.players.black?.name;
    return `${winner ?? "Winner"} wins by checkmate`;
  }
  if (game.outcome.reason === "resignation") {
    const winner = game.outcome.winner === "w" ? game.players.white.name : game.players.black?.name;
    return `${winner ?? "Winner"} wins by resignation`;
  }
  if (game.outcome.reason === "cancelled") return "Game cancelled";
  const labels: Record<string, string> = {
    stalemate: "Draw by stalemate",
    threefold_repetition: "Draw by repetition",
    insufficient_material: "Draw by insufficient material",
    fifty_move: "Draw by the fifty-move rule",
    fivefold_repetition: "Draw by automatic fivefold repetition",
    seventy_five_move: "Draw by the seventy-five-move rule",
    draw: "Draw",
  };
  return labels[game.outcome.reason] ?? "Game over";
}

export function GameRoom({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotionMove, setPromotionMove] = useState<{ from: Square; to: Square } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [access, setAccess] = useState<"loading" | "ready" | "missing" | "denied" | "error">("loading");
  const [inviteUrl, setInviteUrl] = useState("");
  const [privateUrl, setPrivateUrl] = useState("");
  const [inviteShared, setInviteShared] = useState(false);
  const [privateShared, setPrivateShared] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [effects, setEffects] = useState<BoardEffect[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const latestVersion = useRef(-1);
  const previousGame = useRef<GameSnapshot | null>(null);
  const previousEffectGame = useRef<GameSnapshot | null>(null);
  const activeToken = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const acceptGame = useCallback((nextGame: GameSnapshot) => {
    if (!shouldAcceptGameSnapshot(latestVersion.current, nextGame.version)) return false;
    latestVersion.current = nextGame.version;
    setGame(nextGame);
    rememberGame(nextGame);
    setAccess("ready");
    setMessage((current) => current === CONNECTION_MESSAGE ? "" : current);
    return true;
  }, []);

  const loadGame = useCallback(async (sinceVersion?: number) => {
    const hash = window.location.hash;
    const hashHasSeat = hasSeatTokenInHash(hash);
    const linkedToken = readSeatTokenFromHash(hash);
    if (hashHasSeat && !linkedToken) {
      setAccess("denied");
      return;
    }
    let token = linkedToken ?? activeToken.current;
    if (!token) {
      try {
        token = localStorage.getItem(playerKey(gameId));
      } catch {
        token = null;
      }
    }
    if (!token) {
      setAccess("missing");
      return;
    }
    try {
      const suffix = sinceVersion === undefined ? "" : `?sinceVersion=${sinceVersion}`;
      const response = await fetch(`/api/games/${gameId}${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 204) {
        setMessage((current) => current === CONNECTION_MESSAGE ? "" : current);
        return;
      }
      const data = (await response.json()) as { game?: GameSnapshot };
      if (!response.ok || !data.game) {
        if (response.status === 404) setAccess("denied");
        else if (latestVersion.current < 0) setAccess("error");
        else setMessage(CONNECTION_MESSAGE);
        return;
      }
      const seatChanged = activeToken.current !== null && activeToken.current !== token;
      if (seatChanged) {
        latestVersion.current = -1;
        previousGame.current = null;
        previousEffectGame.current = null;
        setSelected(null);
        setPromotionMove(null);
        setEffects([]);
        dragRef.current = null;
        setDrag(null);
      }
      activeToken.current = token;
      try {
        localStorage.setItem(playerKey(gameId), token);
      } catch {
        // The private link remains authoritative when browser storage is unavailable.
      }
      const path = privateGamePath(gameId, token);
      if (window.location.pathname + window.location.hash !== path) {
        window.history.replaceState(null, "", path);
      }
      setPrivateUrl(privateGameUrl(gameId, token, window.location.origin));
      acceptGame(data.game);
    } catch {
      if (latestVersion.current < 0) setAccess("error");
      else setMessage(CONNECTION_MESSAGE);
    }
  }, [acceptGame, gameId]);

  useEffect(() => {
    try {
      setInviteUrl(localStorage.getItem(inviteKey(gameId)) ?? "");
    } catch {
      setInviteUrl("");
    }
    setSoundOn(readSoundPreference());
    void loadGame();
    const reloadSeat = () => void loadGame();
    window.addEventListener("hashchange", reloadSeat);
    return () => window.removeEventListener("hashchange", reloadSeat);
  }, [gameId, loadGame]);

  useEffect(() => {
    if (!game || game.status === "completed") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadGame(latestVersion.current);
    };
    const timer = window.setInterval(refresh, 3_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [game, loadGame]);

  useEffect(() => {
    if (!game) return;
    const previous = previousGame.current;
    previousGame.current = game;
    const markerKey = `chessriot:sound:last-ply:${gameId}`;
    if (!previous) {
      try {
        sessionStorage.setItem(markerKey, String(game.plyCount));
      } catch {
        // The in-memory previous snapshot still prevents replay in this view.
      }
      return;
    }
    const sound = classifyGameSound(previous, game);
    if (!sound || !soundOn) return;
    try {
      const lastPlayedPly = Number(sessionStorage.getItem(markerKey) ?? "-1");
      if (lastPlayedPly >= game.plyCount) return;
      sessionStorage.setItem(markerKey, String(game.plyCount));
    } catch {
      // Continue with in-memory deduplication when session storage is blocked.
    }
    playGameSound(sound);
  }, [game, gameId, soundOn]);

  useEffect(() => {
    if (!game) return;
    const nextEffects = boardEffects(previousEffectGame.current, game);
    previousEffectGame.current = game;
    if (!nextEffects.length) return;
    setEffects(nextEffects);
    const timer = window.setTimeout(() => setEffects([]), 240);
    return () => window.clearTimeout(timer);
  }, [game]);

  useEffect(() => {
    setSelected(null);
    setPromotionMove(null);
    setConfirmEnd(false);
    dragRef.current = null;
    setDrag(null);
  }, [game?.version]);

  useEffect(() => {
    if (!promotionMove) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPromotionMove(null);
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [promotionMove]);

  const chess = useMemo(() => game ? new Chess(game.fen) : null, [game]);
  const legalMoves = useMemo<Move[]>(() => {
    if (!chess || !selected) return [];
    return chess.moves({ square: selected, verbose: true });
  }, [chess, selected]);
  const lostPieces = useMemo(
    () => game ? capturedPiecesByVictimColor(game.moves) : { w: [], b: [] },
    [game],
  );
  const checkedKingSquare = useMemo(
    () => chess ? findCheckedKingSquare(chess) : null,
    [chess],
  );

  const squares = useMemo(() => {
    if (!game || game.you.color === "w") {
      return RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}` as Square));
    }
    return [...RANKS].reverse().flatMap((rank) =>
      [...FILES].reverse().map((file) => `${file}${rank}` as Square),
    );
  }, [game]);

  const canMove = Boolean(game && game.status === "active" && game.turn === game.you.color && !busy);
  const lastMove = game?.moves.at(-1);

  function effectStyle(effect: BoardEffect): CSSProperties {
    const fromIndex = squares.indexOf(effect.from as Square);
    const toIndex = squares.indexOf(effect.to as Square);
    if (fromIndex < 0 || toIndex < 0) return {};
    const x = fromIndex % 8 - toIndex % 8;
    const y = Math.floor(fromIndex / 8) - Math.floor(toIndex / 8);
    return {
      "--move-x": `${x * 100}%`,
      "--move-y": `${y * 100}%`,
    } as CSSProperties;
  }

  function playInvalidSound() {
    if (!soundOn) return;
    void unlockGameSounds().then((unlocked) => {
      if (unlocked) playGameSound("invalid");
    });
  }

  async function sendMove(from: Square, to: Square, promotion?: Promotion) {
    if (!game || !canMove) return;
    const token = activeToken.current;
    if (!token) return setAccess("missing");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          from,
          to,
          ...(promotion ? { promotion } : {}),
          expectedVersion: game.version,
          requestId: generateUuid(),
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        error?: { code?: string; message?: string };
      };
      if (data.game) acceptGame(data.game);
      if (!response.ok) {
        setMessage(
          data.error?.code === "must_answer_check"
            ? illegalDestinationMessage(true)
            : apiMessage(data, "That move did not work"),
        );
        if (data.error?.code !== "stale_position") playInvalidSound();
      }
    } catch {
      setMessage("Could not send the move. Refreshing the board…");
      await loadGame(latestVersion.current);
    } finally {
      setBusy(false);
      setSelected(null);
      setPromotionMove(null);
    }
  }

  async function claimDraw(claim: DrawClaim) {
    if (!game || !canMove) return;
    const token = activeToken.current;
    if (!token) return setAccess("missing");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          claim,
          expectedVersion: game.version,
          requestId: generateUuid(),
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        error?: { message?: string };
      };
      if (data.game) acceptGame(data.game);
      if (!response.ok) {
        setMessage(apiMessage(data, "That draw cannot be claimed now"));
        playInvalidSound();
      }
    } catch {
      setMessage("Could not claim the draw. Refreshing the board…");
      await loadGame(latestVersion.current);
    } finally {
      setBusy(false);
    }
  }

  function tryBoardMove(from: Square, to: Square) {
    if (!chess || !game || !canMove) return;
    const targetMoves = chess.moves({ square: from, verbose: true }).filter((move) => move.to === to);
    if (targetMoves.length === 0) {
      setSelected(from);
      setMessage(illegalDestinationMessage(game.check));
      playInvalidSound();
      return;
    }
    if (targetMoves.some((move) => Boolean(move.promotion))) {
      setPromotionMove({ from, to });
    } else {
      void sendMove(from, to);
    }
  }

  function tapSquare(square: Square) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (soundOn) void unlockGameSounds();
    if (!chess || !game) return;
    if (!canMove) {
      if (game.status === "active") playInvalidSound();
      return;
    }
    const targetMoves = selected ? legalMoves.filter((move) => move.to === square) : [];
    if (selected && targetMoves.length > 0) {
      tryBoardMove(selected, square);
      return;
    }
    const piece = chess.get(square);
    if (piece?.color === game.you.color) {
      if (game.check && chess.moves({ square, verbose: true }).length === 0) {
        setSelected(null);
        setMessage(pieceCannotAnswerCheckMessage());
        playInvalidSound();
        return;
      }
      setSelected(square);
      setMessage("");
    } else if (selected) {
      setMessage(illegalDestinationMessage(game.check));
      playInvalidSound();
    } else {
      setSelected(null);
    }
  }

  function squareAtPoint(x: number, y: number): Square | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-square]");
    const value = element?.dataset.square;
    return value && /^[a-h][1-8]$/.test(value) ? value as Square : null;
  }

  function startPieceDrag(event: ReactPointerEvent<HTMLSpanElement>, square: Square) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!chess || !game || !canMove || chess.get(square)?.color !== game.you.color) return;
    if (soundOn) void unlockGameSounds();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: DragState = {
      pointerId: event.pointerId,
      from: square,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      over: square,
    };
    dragRef.current = next;
    setDrag(next);
    setSelected(square);
    setMessage("");
  }

  function movePieceDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const moved = current.moved || Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    ) >= 6;
    const next: DragState = {
      ...current,
      x: event.clientX,
      y: event.clientY,
      moved,
      over: moved ? squareAtPoint(event.clientX, event.clientY) : current.from,
    };
    dragRef.current = next;
    setDrag(next);
    if (moved) event.preventDefault();
  }

  function finishPieceDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const target = current.moved ? squareAtPoint(event.clientX, event.clientY) : current.from;
    dragRef.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current.moved) {
      setSelected(current.from);
      return;
    }
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    if (target) tryBoardMove(current.from, target);
    else {
      setSelected(current.from);
      setMessage(game?.check
        ? illegalDestinationMessage(true)
        : "Drop the piece on a highlighted square.");
      playInvalidSound();
    }
  }

  function cancelPieceDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setSelected(current.from);
  }

  async function shareInvite() {
    if (!inviteUrl) return;
    const markShared = () => {
      setInviteShared(true);
      window.setTimeout(() => setInviteShared(false), 2_000);
    };
    try {
      if (navigator.share) {
        await navigator.share({
          title: "ChessRiot challenge",
          text: "Your move. Join my ChessRiot game!",
          url: inviteUrl,
        });
        markShared();
        return;
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      markShared();
    } catch {
      setMessage("Select and copy the invitation link below.");
    }
  }

  async function sharePrivateLink() {
    if (!privateUrl) return;
    const markShared = () => {
      setPrivateShared(true);
      window.setTimeout(() => setPrivateShared(false), 2_000);
    };
    try {
      if (navigator.share) {
        await navigator.share({
          title: "My private ChessRiot game link",
          text: "My private ChessRiot seat. Keep this link private.",
          url: privateUrl,
        });
        markShared();
        return;
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(privateUrl);
      markShared();
    } catch {
      setMessage("Select and copy your private game link below.");
    }
  }

  async function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPreference(next);
    if (next && await unlockGameSounds()) playGameSound("move");
  }

  async function endGame() {
    if (!game || game.status === "completed") return;
    const token = activeToken.current;
    if (!token) return setAccess("missing");
    setEnding(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          expectedVersion: game.version,
          requestId: generateUuid(),
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        error?: { message?: string };
      };
      if (data.game) acceptGame(data.game);
      if (!response.ok) setMessage(apiMessage(data, "Could not end the game"));
    } catch {
      setMessage("Could not end the game. Refreshing the board…");
      await loadGame(latestVersion.current);
    } finally {
      setBusy(false);
      setEnding(false);
      setConfirmEnd(false);
    }
  }

  if (access === "loading") {
    return <main className="game-shell"><header className="topbar"><Brand /></header><div className="loading-block">ASSEMBLING BOARD…</div></main>;
  }
  if (access === "error") {
    return (
      <main className="join-shell"><header className="topbar"><Brand /></header><section className="join-stage">
        <div className="voxel-card state-card"><span className="big-glyph">↻</span><h1>CONNECTION INTERRUPTED</h1>
          <p>The arena could not load yet. Check your connection and try again.</p>
          <button className="secondary-button" type="button" onClick={() => {
            setAccess("loading");
            void loadGame();
          }}>TRY AGAIN</button>
        </div>
      </section></main>
    );
  }
  if (access === "missing" || access === "denied") {
    const denied = access === "denied";
    return (
      <main className="join-shell"><header className="topbar"><Brand /></header><section className="join-stage">
        <div className="voxel-card state-card"><span className="big-glyph">⌁</span><h1>{denied ? "PRIVATE LINK INVALID" : "SEAT KEY MISSING"}</h1>
          <p>{denied
            ? "This private link cannot access that seat. Use the exact link created inside your game."
            : "Open the game on its original device and choose COPY PRIVATE LINK. That new link works on every device."}</p>
          <Link className="secondary-button" href="/">GO HOME</Link>
        </div>
      </section></main>
    );
  }
  if (!game || !chess) return null;

  const turnName = game.turn === "w" ? game.players.white.name : game.players.black?.name ?? "Black";
  const statusText = game.status === "waiting"
    ? "Waiting for Player 2"
    : game.status === "completed"
      ? outcomeText(game)
      : game.check
        ? game.turn === game.you.color ? "CHECK! Protect your king" : `${turnName} is in check`
        : game.turn === game.you.color ? "Your turn" : `${turnName}’s turn`;
  const draggedPiece = drag ? chess.get(drag.from) : null;

  return (
    <main className="game-shell">
      <header className="topbar game-topbar">
        <Brand />
        <div className="topbar-actions">
          <button
            className="sound-toggle"
            type="button"
            aria-pressed={soundOn}
            aria-label={soundOn ? "Mute game sounds" : "Turn on game sounds"}
            onClick={() => void toggleSound()}
          >
            <span aria-hidden="true">{soundOn ? "◖))" : "◖×"}</span>
            <b>{soundOn ? "SOUND ON" : "MUTED"}</b>
          </button>
          <Link href="/" className="home-link">NEW GAME</Link>
          <Link href="/changelog" className="home-link">v{APP_VERSION}</Link>
        </div>
      </header>
      <section className="game-layout">
        <div className="board-column">
          <div className="match-banner">
            <div className={`player-card white-player${game.you.color === "w" ? " you-player" : ""}`}>
              <span className="player-piece piece-w" aria-hidden="true">♟</span>
              <div>
                <small>WHITE{game.you.color === "w" ? " • YOU" : ""}</small>
                <strong>{game.players.white.name}</strong>
              </div>
              <span className="status-lamp" data-active={game.status === "active" && game.turn === "w" ? "true" : "false"} />
            </div>
            <div className="versus">VS</div>
            <div className={`player-card black-player${game.you.color === "b" ? " you-player" : ""}`}>
              <span className="player-piece piece-b" aria-hidden="true">♟</span>
              <div>
                <small>BLACK{game.you.color === "b" ? " • YOU" : ""}</small>
                <strong>{game.players.black?.name ?? "Waiting…"}</strong>
              </div>
              <span className="status-lamp" data-active={game.status === "active" && game.turn === "b" ? "true" : "false"} />
            </div>
          </div>

          <div className="captured-strip" aria-label="Captured pieces">
            <div>
              <span>WHITE PIECES LOST</span>
              <b>{lostPieces.w.length ? lostPieces.w.map((piece, index) => (
                <i key={`w-${piece}-${index}`} aria-label={`white ${PIECE_NAMES[piece]}`}>
                  {PIECES.w[piece]}
                </i>
              )) : "—"}</b>
            </div>
            <div>
              <span>BLACK PIECES LOST</span>
              <b>{lostPieces.b.length ? lostPieces.b.map((piece, index) => (
                <i key={`b-${piece}-${index}`} aria-label={`black ${PIECE_NAMES[piece]}`}>
                  {PIECES.b[piece]}
                </i>
              )) : "—"}</b>
            </div>
          </div>

          <div
            className={`turn-panel ${game.turn === game.you.color ? "mine" : "theirs"} ${game.status}${game.check ? " check" : ""}`}
            role={game.check ? "alert" : "status"}
            aria-live={game.check ? "assertive" : "polite"}
          >
            <span>{game.status === "completed" ? "⚑" : game.check ? "!" : "◆"}</span>
            <div><small>{game.check && game.status !== "completed" ? "CHECK" : "MATCH STATUS"}</small><strong>{statusText}</strong></div>
            {busy ? <b>{ending ? "ENDING GAME…" : game.mode === "solo" ? "RIOT BOT THINKING…" : "LOCKING MOVE…"}</b> : null}
          </div>

          {game.claimableDraws.length > 0 ? (
            <div className="draw-claims" role="group" aria-label="Available draw claims">
              <span>DRAW AVAILABLE</span>
              {game.claimableDraws.map((claim) => (
                <button
                  type="button"
                  key={claim}
                  disabled={busy}
                  onClick={() => void claimDraw(claim)}
                >
                  {claim === "threefold_repetition"
                    ? "CLAIM REPETITION"
                    : "CLAIM 50-MOVE DRAW"}
                </button>
              ))}
            </div>
          ) : null}

          <div className="board-wrap" aria-busy={busy} data-interactive={canMove ? "true" : "false"}>
            <div className="chessboard" role="grid" aria-label="Chess board">
              {squares.map((square, index) => {
                const piece = chess.get(square);
                const legal = legalMoves.some((move) => move.to === square);
                const capture = legal && Boolean(piece || legalMoves.some((move) => move.to === square && move.isEnPassant()));
                const isSelected = selected === square;
                const isLast = lastMove?.from === square || lastMove?.to === square;
                const isCheckedKing = checkedKingSquare === square;
                const isDragOver = drag?.moved && drag.over === square && legal;
                const effect = effects.find((candidate) => candidate.to === square);
                const file = square[0];
                const rank = square[1];
                const showRank = index % 8 === 0;
                const showFile = index >= 56;
                return (
                  <button
                    type="button"
                    role="gridcell"
                    aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}` : " empty"}${isCheckedKing ? ", in check" : ""}${legal ? ", legal destination" : ""}`}
                    aria-disabled={!canMove}
                    aria-selected={isSelected}
                    data-square={square}
                    className={`square ${isDarkSquare(square) ? "dark-square" : "light-square"}${isSelected ? " selected" : ""}${isLast ? " last-move" : ""}${isCheckedKing ? " king-in-check" : ""}${legal ? capture ? " capture-target" : " legal-target" : ""}${isDragOver ? " drag-over" : ""}${effect?.capture ? " capture-impact" : ""}`}
                    key={square}
                    onClick={() => tapSquare(square)}
                    disabled={busy}
                  >
                    {showRank ? <span className="rank-label">{rank}</span> : null}
                    {showFile ? <span className="file-label">{file}</span> : null}
                    {piece ? (
                      <span
                        className={`piece piece-${piece.color}${drag?.from === square && drag.moved ? " dragging" : ""}${effect ? " piece-arriving" : ""}`}
                        style={effect ? effectStyle(effect) : undefined}
                        draggable={false}
                        onPointerDown={(event) => startPieceDrag(event, square)}
                        onPointerMove={movePieceDrag}
                        onPointerUp={finishPieceDrag}
                        onPointerCancel={cancelPieceDrag}
                      >
                        {PIECES[piece.color][piece.type]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          {message ? <p className="board-message" role="status">{message}</p> : null}
        </div>

        <aside className="game-sidebar">
          {game.status === "waiting" ? (
            <section className="side-card invite-card">
              <span className="side-icon">⌁</span><h2>INVITE PLAYER 2</h2>
              <p>Send this private link. The first person to submit it claims Black.</p>
              {inviteUrl ? <><button className="primary-button" onClick={() => void shareInvite()}>{inviteShared ? "LINK READY ✓" : "SHARE INVITATION"}</button>
                <input className="invite-field" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Invitation link" /></> :
                <p className="form-error">The invitation link is no longer stored on this device.</p>}
            </section>
          ) : null}
          <section className="side-card seat-card">
            <span className="side-icon">▦</span><h2>YOUR PRIVATE GAME LINK</h2>
            <p>Works on any computer or device. Anyone with this link can play as you, so keep it private.</p>
            <button className="primary-button" onClick={() => void sharePrivateLink()}>
              {privateShared ? "PRIVATE LINK READY ✓" : "COPY PRIVATE LINK"}
            </button>
            <input className="invite-field" value={privateUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Your private game link" />
          </section>
          <section className="side-card actions-card">
            <h2>GAME ACTIONS</h2>
            <Link className="secondary-button" href="/">NEW GAME</Link>
            {game.status !== "completed" ? (
              confirmEnd ? (
                <div className="end-confirm" role="alert">
                  <p>{game.status === "waiting"
                    ? "Cancel this game? The invitation will stop working."
                    : "End this game? This counts as a resignation and your opponent wins."}</p>
                  <button className="danger-button" type="button" disabled={busy} onClick={() => void endGame()}>
                    {busy ? "ENDING…" : "CONFIRM END"}
                  </button>
                  <button className="quiet-button" type="button" disabled={busy} onClick={() => setConfirmEnd(false)}>
                    KEEP PLAYING
                  </button>
                </div>
              ) : (
                <button className="quiet-button" type="button" onClick={() => setConfirmEnd(true)}>
                  {game.status === "waiting" ? "CANCEL GAME" : "END GAME"}
                </button>
              )
            ) : null}
          </section>
          <section className="side-card moves-card">
            <div className="side-heading"><h2>MOVE LOG</h2><span>{game.plyCount} PLY</span></div>
            {game.moves.length === 0 ? <p className="empty-moves">No moves yet. White opens the riot.</p> : (
              <ol className="move-list">
                {Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => (
                  <li key={index}><span>{index + 1}.</span><b>{game.moves[index * 2]?.san}</b><b>{game.moves[index * 2 + 1]?.san ?? ""}</b></li>
                ))}
              </ol>
            )}
          </section>
          <section className="side-card rules-card"><span aria-hidden="true">i</span><div><strong>GAME INFO</strong><small>
            {game.mode === "solo" && game.aiDifficulty
              ? `Standard chess • Riot Bot level ${game.aiDifficulty} • ${DIFFICULTY_LABELS[game.aiDifficulty]}`
              : "Standard chess • Drag or tap • Every move saved"}
          </small></div></section>
        </aside>
      </section>

      {drag?.moved && draggedPiece ? (
        <span
          className={`drag-ghost piece-${draggedPiece.color}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {PIECES[draggedPiece.color][draggedPiece.type]}
        </span>
      ) : null}

      {promotionMove ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-card"><p>PROMOTE YOUR PAWN</p><div>
            {(["q", "r", "b", "n"] as Promotion[]).map((piece) => (
              <button
                key={piece}
                aria-label={`Promote to ${PIECE_NAMES[piece]}`}
                autoFocus={piece === "q"}
                onClick={() => void sendMove(promotionMove.from, promotionMove.to, piece)}
              >
                {PIECES[game.you.color][piece]}
              </button>
            ))}
          </div><button className="cancel-promotion" onClick={() => setPromotionMove(null)}>CANCEL</button></div>
        </div>
      ) : null}
    </main>
  );
}
