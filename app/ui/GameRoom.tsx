"use client";

import { Chess, type Move, type Square } from "chess.js";
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
import { apiErrorMessage, requestHeaders } from "@/lib/client-http";
import {
  generateUuid,
  hasSeatTokenInHash,
  inviteKey,
  playerKey,
  privateGamePath,
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
  actionEndpointSquares,
  capturedPiecesByVictimColor,
  CHESS_PIECE_NAMES,
  checkedKingSquare as findCheckedKingSquare,
  DIFFICULTY_LABELS,
  gameStatusText,
  illegalDestinationMessage,
  isDarkSquare,
  orientedBoardSquares,
  pieceCannotAnswerCheckMessage,
} from "@/lib/game-presentation";
import { classifyGameFinisher, type GameFinisher } from "@/lib/game-finishers";
import {
  postGameReactionWindowOpen,
  type PublicReaction,
  type ReactionKey,
  reactionPreset,
} from "@/lib/game-reactions";
import { optimisticMoveSnapshot, shouldAcceptGameSnapshot } from "@/lib/game-snapshots";
import {
  buildReplayFrames,
  nextHistoryCursor,
  previousHistoryCursor,
  replayFrameLabel,
  resolvedHistoryPly,
  type HistoryCursor,
} from "@/lib/game-replay";
import { legalMagicMoves, magicSecondStep } from "@/lib/game-rules";
import { hasMagicRule, type DoubleMovePiece } from "@/lib/magic-rules";
import { magicDraftTapDecision } from "@/lib/magic-turn-ui";
import {
  describeMoveIntent,
  moveIntentStillValid,
  readMoveConfirmationPreference,
  type MoveIntent,
  writeMoveConfirmationPreference,
} from "@/lib/move-confirmation";
import type { DrawClaim, GameSnapshot, Promotion } from "@/lib/game-types";
import { APP_VERSION } from "@/lib/version";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";
import { CheckmateFinisher } from "./CheckmateFinisher";
import { HistoryControls } from "./HistoryControls";
import { ReactionPanel } from "./ReactionPanel";
import { ReplayViewer } from "./ReplayViewer";
import { TurnDeadline } from "./TurnDeadline";

const CONNECTION_MESSAGE = "Connection interrupted. We’ll keep trying.";
const REACTION_HIDDEN_KEY_PREFIX = "chessriot:reactions:hidden:";
const FINISHER_DURATION_MS = 1_300;
const OPENING_INTRO_DURATION_MS = 360;

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

interface MagicDraft {
  from: Square;
  to: Square;
  pieceSquare: Square;
  piece: DoubleMovePiece;
  fen: string;
}

export function GameRoom({ gameId }: { gameId: string }) {
  const [serverGame, setServerGame] = useState<GameSnapshot | null>(null);
  const [optimisticGame, setOptimisticGame] = useState<GameSnapshot | null>(null);
  const game = optimisticGame ?? serverGame;
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotionMove, setPromotionMove] = useState<{ from: Square; to: Square } | null>(null);
  const [magicDraft, setMagicDraft] = useState<MagicDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [access, setAccess] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteShared, setInviteShared] = useState(false);
  const [openingIntro, setOpeningIntro] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [effects, setEffects] = useState<BoardEffect[]>([]);
  const [historyPly, setHistoryPly] = useState<HistoryCursor>(null);
  const [confirmEveryMove, setConfirmEveryMove] = useState(false);
  const [pendingMove, setPendingMove] = useState<MoveIntent | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [reactions, setReactions] = useState<PublicReaction[]>([]);
  const [reactionQueue, setReactionQueue] = useState<PublicReaction[]>([]);
  const [reactionBurst, setReactionBurst] = useState<PublicReaction | null>(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [reactionSending, setReactionSending] = useState<ReactionKey | null>(null);
  const [reactionMessage, setReactionMessage] = useState("");
  const [reactionsHidden, setReactionsHidden] = useState(false);
  const [finisher, setFinisher] = useState<GameFinisher | null>(null);
  const latestVersion = useRef(-1);
  const previousGame = useRef<GameSnapshot | null>(null);
  const previousEffectGame = useRef<GameSnapshot | null>(null);
  const activeToken = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const effectTimer = useRef<number | null>(null);
  const openingIntroTimer = useRef<number | null>(null);
  const reactionCursor = useRef<number | null>(null);
  const previousFinisherGame = useRef<GameSnapshot | null>(null);
  const finisherTimer = useRef<number | null>(null);
  const reactionTrigger = useRef<HTMLButtonElement | null>(null);
  const moveConfirmDialog = useRef<HTMLDialogElement | null>(null);
  const moveConfirmReturnFocus = useRef<HTMLElement | null>(null);
  const moveConfirmFallback = useRef<HTMLDivElement | null>(null);
  const moveCommitInFlight = useRef(false);
  const postGameReactionsOpen = Boolean(
    game?.status === "completed"
    && postGameReactionWindowOpen(game.updatedAt),
  );

  const acceptGame = useCallback((nextGame: GameSnapshot) => {
    if (!shouldAcceptGameSnapshot(latestVersion.current, nextGame.version)) return false;
    latestVersion.current = nextGame.version;
    setServerGame(nextGame);
    setOptimisticGame(null);
    rememberGame(nextGame);
    setAccess("ready");
    setMessage((current) => current === CONNECTION_MESSAGE ? "" : current);
    return true;
  }, []);

  const beginOpeningIntro = useCallback((nextGame: GameSnapshot) => {
    if (
      nextGame.mode !== "solo"
      || nextGame.you.color !== "b"
      || nextGame.plyCount < 1
      || nextGame.moves.length < 1
    ) return;
    const markerKey = `chessriot:opening-intro:${gameId}`;
    try {
      if (sessionStorage.getItem(markerKey) !== "1") return;
      sessionStorage.removeItem(markerKey);
    } catch {
      return;
    }
    const openingMove = nextGame.moves[0];
    setOpeningIntro(true);
    if (openingIntroTimer.current !== null) {
      window.clearTimeout(openingIntroTimer.current);
    }
    openingIntroTimer.current = window.setTimeout(() => {
      openingIntroTimer.current = null;
      setOpeningIntro(false);
      if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
      setEffects([{
        ply: openingMove.ply,
        from: openingMove.from,
        to: openingMove.to,
        capture: openingMove.san.includes("x"),
      }]);
      effectTimer.current = window.setTimeout(() => {
        effectTimer.current = null;
        setEffects([]);
      }, 240);
    }, OPENING_INTRO_DURATION_MS);
  }, [gameId]);

  const loadGame = useCallback(async (sinceVersion?: number) => {
    const hash = window.location.hash;
    const hashHasSeat = hasSeatTokenInHash(hash);
    const linkedToken = readSeatTokenFromHash(hash);
    let usingSavedAccess = hashHasSeat && !linkedToken;
    if (hashHasSeat && !linkedToken) setMessage("The private seat key in this link is invalid. Trying saved access instead.");
    const previousToken = activeToken.current;
    let savedToken: string | null = null;
    try {
      savedToken = localStorage.getItem(playerKey(gameId));
    } catch {
      savedToken = null;
    }
    const candidates: Array<string | null> = [];
    for (const candidate of [linkedToken, previousToken, savedToken]) {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }
    candidates.push(null);
    try {
      let response: Response | null = null;
      let token: string | null = null;
      for (let index = 0; index < candidates.length; index += 1) {
        token = candidates[index];
        const seatCandidateChanged = token !== previousToken;
        const suffix = sinceVersion === undefined || seatCandidateChanged
          ? ""
          : `?sinceVersion=${sinceVersion}`;
        response = await fetch(`/api/games/${gameId}${suffix}`, {
          headers: requestHeaders(token),
          cache: "no-store",
        });
        const canTrySavedAccess = (response.status === 401 || response.status === 404)
          && index < candidates.length - 1;
        if (!canTrySavedAccess) break;
        if (token === linkedToken && linkedToken !== previousToken) {
          usingSavedAccess = true;
          setMessage("That private seat link did not match. Trying saved access instead.");
        }
      }
      if (!response) {
        setAccess("error");
        return;
      }
      if (response.status === 204) {
        setMessage((current) =>
          usingSavedAccess || current === CONNECTION_MESSAGE ? "" : current);
        return;
      }
      const data = (await response.json()) as {
        game?: GameSnapshot;
        error?: { code?: string };
      };
      if (response.status === 401) {
        setAccess("denied");
        return;
      }
      if (!response.ok || !data.game) {
        if (response.status === 404) setAccess("denied");
        else if (latestVersion.current < 0) setAccess("error");
        else setMessage(CONNECTION_MESSAGE);
        return;
      }
      const seatChanged = previousToken !== token;
      if (seatChanged) {
        latestVersion.current = -1;
        setOptimisticGame(null);
        previousGame.current = null;
        previousEffectGame.current = null;
        setSelected(null);
        setPromotionMove(null);
        setEffects([]);
        setReactions([]);
        setReactionQueue([]);
        setReactionBurst(null);
        reactionCursor.current = null;
        previousFinisherGame.current = null;
        dragRef.current = null;
        setDrag(null);
        setHistoryPly(null);
        setPendingMove(null);
      }
      activeToken.current = token;
      if (token) {
        try {
          localStorage.setItem(playerKey(gameId), token);
        } catch {
          // The private link still protects the seat if storage is unavailable.
        }
        const path = privateGamePath(gameId, token);
        if (window.location.pathname + window.location.hash !== path) {
          window.history.replaceState(null, "", path);
        }
      }
      if (latestVersion.current < 0) beginOpeningIntro(data.game);
      if (usingSavedAccess) setMessage("");
      acceptGame(data.game);
    } catch {
      if (latestVersion.current < 0) setAccess("error");
      else setMessage(CONNECTION_MESSAGE);
    }
  }, [acceptGame, beginOpeningIntro, gameId]);

  const loadReactions = useCallback(async () => {
    const token = activeToken.current;
    try {
      const response = await fetch(`/api/games/${gameId}/reactions`, {
        headers: requestHeaders(token),
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { reactions?: PublicReaction[] };
      if (!Array.isArray(data.reactions)) return;
      const next = [...data.reactions].sort((a, b) => a.sequence - b.sequence);
      setReactions(next);
      const newest = next.at(-1)?.sequence ?? 0;
      if (reactionCursor.current === null) {
        reactionCursor.current = newest;
        return;
      }
      const unseen = next.filter((reaction) =>
        reaction.sequence > reactionCursor.current!
        && reaction.senderColor !== serverGame?.you.color);
      reactionCursor.current = Math.max(reactionCursor.current, newest);
      if (!reactionsHidden && unseen.length > 0) {
        setReactionQueue((current) => {
          const known = new Set(current.map((reaction) => reaction.sequence));
          return [...current, ...unseen.filter((reaction) => !known.has(reaction.sequence))]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-6);
        });
      }
    } catch {
      // Game polling remains the connection-status source of truth.
    }
  }, [gameId, reactionsHidden, serverGame?.you.color]);

  useEffect(() => {
    try {
      setInviteUrl(localStorage.getItem(inviteKey(gameId)) ?? "");
      setReactionsHidden(
        localStorage.getItem(`${REACTION_HIDDEN_KEY_PREFIX}${gameId}`) === "true",
      );
    } catch {
      setInviteUrl("");
    }
    setSoundOn(readSoundPreference());
    setConfirmEveryMove(readMoveConfirmationPreference());
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
    if (
      !game
      || game.mode !== "multiplayer"
      || game.status === "waiting"
      || !game.players.black
    ) return;
    void loadReactions();
    if (game.status === "completed" && !postGameReactionsOpen) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadReactions();
    };
    const timer = window.setInterval(refresh, 3_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [game, loadReactions, postGameReactionsOpen]);

  useEffect(() => {
    if (
      !game ||
      busy ||
      game.mode !== "solo" ||
      game.status !== "active" ||
      game.turn === game.you.color
    ) return;
    // The human move is already durable and visible. This read computes any
    // pending Riot Bot reply without holding the human move response open.
    void loadGame(game.version);
  }, [busy, game, loadGame]);

  useEffect(() => {
    if (!game) return;
    // The preview is visual only. Keep the sound baseline on the last
    // authoritative snapshot so the accepted human ply plays exactly once.
    if (optimisticGame) return;
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
  }, [game, gameId, optimisticGame, soundOn]);

  useEffect(() => {
    if (!game) return;
    const previous = previousEffectGame.current;
    const nextEffects = boardEffects(previous, game);
    previousEffectGame.current = game;
    if (!nextEffects.length) {
      if (previous && game.plyCount < previous.plyCount) {
        if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
        effectTimer.current = null;
        setEffects([]);
      }
      return;
    }
    if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    setEffects(nextEffects);
    effectTimer.current = window.setTimeout(() => {
      effectTimer.current = null;
      setEffects([]);
    }, 240);
  }, [game]);

  useEffect(() => () => {
    if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    if (openingIntroTimer.current !== null) window.clearTimeout(openingIntroTimer.current);
  }, []);

  useEffect(() => {
    if (reactionsHidden) {
      setReactionQueue([]);
      setReactionBurst(null);
      return;
    }
    if (reactionBurst || reactionQueue.length === 0) return;
    setReactionBurst(reactionQueue[0]);
    setReactionQueue((current) => current.slice(1));
  }, [reactionBurst, reactionQueue, reactionsHidden]);

  useEffect(() => {
    if (!reactionBurst) return;
    const timer = window.setTimeout(() => setReactionBurst(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [reactionBurst]);

  useEffect(() => {
    if (!serverGame) return;
    const previous = previousFinisherGame.current;
    previousFinisherGame.current = serverGame;
    const nextFinisher = classifyGameFinisher(previous, serverGame);
    if (!nextFinisher) return;
    if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
    setFinisher(nextFinisher);
    finisherTimer.current = window.setTimeout(() => {
      finisherTimer.current = null;
      setFinisher(null);
    }, FINISHER_DURATION_MS);
  }, [serverGame]);

  useEffect(() => () => {
    if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
  }, []);

  useEffect(() => {
    if (!reactionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setReactionOpen(false);
      reactionTrigger.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reactionOpen]);

  useEffect(() => {
    setSelected(null);
    setPromotionMove(null);
    setMagicDraft(null);
    setPendingMove(null);
    setConfirmEnd(false);
    dragRef.current = null;
    setDrag(null);
  }, [game?.version]);

  useEffect(() => {
    const dialog = moveConfirmDialog.current;
    if (!dialog) return;
    if (pendingMove && !dialog.open) {
      dialog.showModal();
    } else if (!pendingMove && dialog.open) {
      dialog.close();
    }
  }, [pendingMove]);

  useEffect(() => {
    if (!promotionMove) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPromotionMove(null);
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [promotionMove]);

  const history = useMemo(() => {
    try {
      return {
        frames: buildReplayFrames(
          openingIntro ? [] : game?.moves ?? [],
          game?.initialFen,
        ),
        error: false,
      };
    } catch {
      return {
        frames: buildReplayFrames([]),
        error: true,
      };
    }
  }, [game?.initialFen, game?.moves, openingIntro]);
  const latestHistoryPly = Math.max(0, history.frames.length - 1);
  const visibleHistoryPly = resolvedHistoryPly(historyPly, latestHistoryPly);
  const viewingHistory = historyPly !== null && !history.error;
  const historyFrame = history.frames[visibleHistoryPly] ?? history.frames[0];

  useEffect(() => {
    if (history.error && historyPly !== null) setHistoryPly(null);
  }, [history.error, historyPly]);

  const chess = useMemo(
    () => game
      ? new Chess(
        viewingHistory
          ? historyFrame.fen
          : openingIntro
          ? game.initialFen
          : magicDraft?.fen ?? game.fen,
      )
      : null,
    [game, historyFrame.fen, magicDraft, openingIntro, viewingHistory],
  );
  const liveChess = useMemo(
    () => game ? new Chess(game.fen) : null,
    [game],
  );
  const legalMoves = useMemo<Move[]>(() => {
    if (!chess || !selected || viewingHistory) return [];
    return legalMagicMoves(chess, game?.magicRules ?? null, selected);
  }, [chess, game?.magicRules, selected, viewingHistory]);
  const presentedMoves = useMemo(
    () => viewingHistory
      ? (serverGame?.moves ?? []).slice(0, visibleHistoryPly)
      : game?.moves ?? [],
    [game?.moves, serverGame?.moves, viewingHistory, visibleHistoryPly],
  );
  const lostPieces = useMemo(
    () => capturedPiecesByVictimColor(presentedMoves),
    [presentedMoves],
  );
  const checkedKingSquare = useMemo(
    () => chess ? findCheckedKingSquare(chess) : null,
    [chess],
  );

  const squares = useMemo(
    () => orientedBoardSquares(game?.you.color ?? "w"),
    [game?.you.color],
  );

  const canMove = Boolean(
    game
    && !openingIntro
    && !viewingHistory
    && game.status === "active"
    && game.turn === game.you.color
    && !busy,
  );
  const botThinking = Boolean(
    openingIntro || (
    game &&
    liveChess &&
    game.mode === "solo" &&
    game.status === "active" &&
    game.turn !== game.you.color &&
    !liveChess.isGameOver()),
  );
  const lastMove = openingIntro && !viewingHistory
    ? undefined
    : presentedMoves.at(-1);
  const lastMoveEndpoints: string[] = lastMove
    ? actionEndpointSquares(lastMove)
    : [];

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

  function requestMove(
    from: Square,
    to: Square,
    promotion?: Promotion,
    second?: { from: Square; to: Square },
  ): void {
    if (!game || !canMove || moveCommitInFlight.current) return;
    const piece = new Chess(game.fen).get(from)?.type ?? null;
    const intent: MoveIntent = {
      from,
      to,
      ...(promotion ? { promotion } : {}),
      ...(second ? { second } : {}),
      expectedVersion: game.version,
      piece,
    };
    if (!confirmEveryMove) {
      void commitMove(intent);
      return;
    }
    moveConfirmReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setPromotionMove(null);
    setPendingMove(intent);
  }

  function closeMoveConfirmation(): void {
    if (moveConfirmDialog.current?.open) moveConfirmDialog.current.close();
    setPendingMove(null);
  }

  function cancelMoveConfirmation(): void {
    closeMoveConfirmation();
  }

  async function commitMove(intent: MoveIntent) {
    const currentGame = serverGame;
    if (busy || moveCommitInFlight.current) return;
    if (
      !currentGame
      || !moveIntentStillValid(intent, currentGame)
    ) {
      closeMoveConfirmation();
      setMessage("The position changed. Choose your move again.");
      return;
    }
    moveCommitInFlight.current = true;
    closeMoveConfirmation();
    const token = activeToken.current;
    const preview = currentGame.mode === "solo"
      ? optimisticMoveSnapshot(
        currentGame,
        intent.from,
        intent.to,
        intent.promotion,
        { second: intent.second },
      )
      : null;
    const authoritativeVersion = intent.expectedVersion;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setBusy(true);
    setMessage("");
    setSelected(null);
    setPromotionMove(null);
    setMagicDraft(null);
    if (preview) {
      setOptimisticGame(preview);
    }
    try {
      const response = await fetch(`/api/games/${gameId}/moves`, {
        method: "POST",
        headers: requestHeaders(token, true),
        signal: controller.signal,
        body: JSON.stringify({
          from: intent.from,
          to: intent.to,
          ...(intent.promotion ? { promotion: intent.promotion } : {}),
          ...(intent.second ? { second: intent.second } : {}),
          expectedVersion: intent.expectedVersion,
          requestId: generateUuid(),
        }),
      });
      const data = (await response.json()) as {
        game?: GameSnapshot;
        error?: { code?: string; message?: string };
      };
      if (response.status === 401) {
        setOptimisticGame(null);
        setAccess("denied");
        return;
      }
      if (data.game) {
        acceptGame(data.game);
        setOptimisticGame(null);
      }
      if (!response.ok) {
        if (!data.game) setOptimisticGame(null);
        setMessage(
          data.error?.code === "must_answer_check"
            ? illegalDestinationMessage(true)
            : apiErrorMessage(data, "That move did not work"),
        );
        if (data.error?.code !== "stale_position") playInvalidSound();
      } else if (!data.game) {
        setMessage("The move response was incomplete. Refreshing the board…");
        await loadGame(latestVersion.current);
        if (latestVersion.current <= authoritativeVersion) setOptimisticGame(null);
      }
    } catch {
      setMessage("Could not send the move. Refreshing the board…");
      await loadGame(latestVersion.current);
      if (latestVersion.current <= authoritativeVersion) setOptimisticGame(null);
    } finally {
      window.clearTimeout(timeout);
      moveCommitInFlight.current = false;
      setBusy(false);
    }
  }

  async function claimDraw(claim: DrawClaim) {
    if (!game || !canMove) return;
    const token = activeToken.current;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/claims`, {
        method: "POST",
        headers: requestHeaders(token, true),
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
        setMessage(apiErrorMessage(data, "That draw cannot be claimed now"));
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
    const targetMoves = legalMagicMoves(
      chess,
      game.magicRules ?? null,
      from,
    ).filter((move) => move.to === to);
    if (targetMoves.length === 0) {
      setSelected(from);
      setMessage(
        magicDraft
          ? `Move the same ${CHESS_PIECE_NAMES[magicDraft.piece]} again, or finish the turn.`
          : illegalDestinationMessage(game.check),
      );
      playInvalidSound();
      return;
    }
    if (magicDraft) {
      if (from !== magicDraft.pieceSquare) {
        setSelected(magicDraft.pieceSquare);
        setMessage(`Move the same ${CHESS_PIECE_NAMES[magicDraft.piece]} again, or finish the turn.`);
        playInvalidSound();
        return;
      }
      requestMove(
        magicDraft.from,
        magicDraft.to,
        undefined,
        { from, to },
      );
      return;
    }
    if (targetMoves.some((move) => Boolean(move.promotion))) {
      setPromotionMove({ from, to });
      return;
    }
    const firstMove = targetMoves[0];
    if (
      (firstMove?.piece === "r" || firstMove?.piece === "n")
      && hasMagicRule(game.magicRules, "double_move", firstMove.piece)
    ) {
      const afterFirst = new Chess(game.fen);
      afterFirst.move(firstMove);
      const continuation = magicSecondStep(
        afterFirst,
        firstMove.to,
        firstMove.color,
        game.magicRules ?? null,
      );
      if (continuation) {
        setMagicDraft({
          from,
          to,
          pieceSquare: firstMove.to,
          piece: continuation.piece,
          fen: continuation.chess.fen(),
        });
        setSelected(firstMove.to);
        setMessage(`Move that ${CHESS_PIECE_NAMES[continuation.piece]} again, or finish the turn.`);
        return;
      }
    }
    requestMove(from, to);
  }

  function tapSquare(square: Square) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (soundOn) void unlockGameSounds();
    if (!chess || !game) return;
    if (!canMove) {
      if (viewingHistory) return;
      if (game.status === "active") playInvalidSound();
      return;
    }
    const targetMoves = selected ? legalMoves.filter((move) => move.to === square) : [];
    if (magicDraft) {
      const decision = magicDraftTapDecision(
        magicDraft.pieceSquare,
        selected,
        square,
        legalMoves.map((move) => move.to),
      );
      if (decision === "move" && targetMoves.length > 0) {
        tryBoardMove(magicDraft.pieceSquare, square);
        return;
      }
      setSelected(magicDraft.pieceSquare);
      if (decision === "reject") {
        setMessage(`Move the same ${CHESS_PIECE_NAMES[magicDraft.piece]} again, or finish the turn.`);
        playInvalidSound();
      }
      return;
    }
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
    if (magicDraft && square !== magicDraft.pieceSquare) return;
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

  function showHistory(next: HistoryCursor): void {
    if (!serverGame || next === historyPly || (history.error && next !== null)) return;
    setSelected(null);
    setPromotionMove(null);
    setMagicDraft(null);
    setPendingMove(null);
    dragRef.current = null;
    setDrag(null);
    setEffects([]);
    setMessage("");
    setHistoryPly(next);
  }

  function stepHistoryBack(): void {
    showHistory(previousHistoryCursor(
      historyPly,
      latestHistoryPly,
      Boolean(magicDraft),
    ));
  }

  function stepHistoryForward(): void {
    showHistory(nextHistoryCursor(historyPly, latestHistoryPly));
  }

  function returnToLive(): void {
    showHistory(null);
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

  async function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPreference(next);
    if (next && await unlockGameSounds()) playGameSound("move");
  }

  function toggleMoveConfirmation(enabled: boolean): void {
    setConfirmEveryMove(enabled);
    writeMoveConfirmationPreference(enabled);
  }

  async function sendReaction(key: ReactionKey) {
    const token = activeToken.current;
    if (reactionSending) return;
    setReactionSending(key);
    setReactionMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/reactions`, {
        method: "POST",
        headers: requestHeaders(token, true),
        body: JSON.stringify({ reaction: key, requestId: generateUuid() }),
      });
      const data = (await response.json()) as {
        reaction?: PublicReaction;
        error?: { message?: string };
      };
      if (!response.ok || !data.reaction) {
        setReactionMessage(apiErrorMessage(data, "Could not send that reaction"));
        return;
      }
      setReactions((current) => {
        if (current.some((reaction) => reaction.id === data.reaction!.id)) return current;
        return [...current, data.reaction!]
          .sort((a, b) => a.sequence - b.sequence)
          .slice(-20);
      });
      setReactionOpen(false);
      reactionTrigger.current?.focus();
    } catch {
      setReactionMessage("Could not send that reaction");
    } finally {
      setReactionSending(null);
    }
  }

  function toggleReactionsHidden() {
    const next = !reactionsHidden;
    setReactionsHidden(next);
    try {
      localStorage.setItem(`${REACTION_HIDDEN_KEY_PREFIX}${gameId}`, String(next));
    } catch {
      // The setting still applies in this tab when browser storage is blocked.
    }
  }

  async function endGame() {
    if (!game || game.status === "completed") return;
    const token = activeToken.current;
    setEnding(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/end`, {
        method: "POST",
        headers: requestHeaders(token, true),
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
      if (!response.ok) setMessage(apiErrorMessage(data, "Could not end the game"));
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
  if (access === "denied") {
    return (
      <main className="join-shell"><header className="topbar"><Brand /></header><section className="join-stage">
        <div className="voxel-card state-card"><span className="big-glyph">⌁</span><h1>PRIVATE SEAT LINK NEEDED</h1>
          <p>Open the private game link for your seat, or ask the other player for a new invitation.</p>
          <Link className="secondary-button" href="/app">GO TO PLAY</Link>
        </div>
      </section></main>
    );
  }
  if (!game || !chess) return null;

  const displayCheck = viewingHistory ? chess.isCheck() : game.check;
  const statusText = gameStatusText({
    game,
    viewingHistory,
    historyLabel: replayFrameLabel(historyFrame),
    openingIntro,
    magicPiece: magicDraft?.piece,
    displayCheck,
  });
  const draggedPiece = drag ? chess.get(drag.from) : null;
  const burstPreset = reactionBurst ? reactionPreset(reactionBurst.key) : null;
  const reactionsAvailable = Boolean(
    game.mode === "multiplayer"
    && game.status !== "waiting"
    && game.players.black
    && (game.status === "active" || postGameReactionsOpen),
  );

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
          <Link href="/app" className="home-link">NEW GAME</Link>
          <Link href="/changelog" className="home-link">v{APP_VERSION}</Link>
        </div>
      </header>
      <section className="game-layout">
        <div className="board-column">
          <div className="match-banner">
            <div className={`player-card white-player${game.you.color === "w" ? " you-player" : ""}`}>
              <span className="player-piece" aria-hidden="true">
                <ChessPiece type="p" color="w" />
              </span>
              <div>
                <small>WHITE{game.you.color === "w" ? " • YOU" : ""}</small>
                <strong>{game.players.white.name}</strong>
                <span className="captured-by">
                  <small>CAPTURED</small>
                  <b>{lostPieces.b.length ? lostPieces.b.map((piece, index) => (
                    <i key={`white-captured-${piece}-${index}`} aria-label={`black ${CHESS_PIECE_NAMES[piece]}`}>
                      <ChessPiece type={piece} color="b" />
                    </i>
                  )) : "—"}</b>
                </span>
              </div>
              <span className="status-lamp" data-active={game.status === "active" && game.turn === "w" ? "true" : "false"} />
              {!reactionsHidden && reactionBurst?.senderColor === "w" && burstPreset ? (
                <span className="reaction-bubble" role="status" aria-live="polite">
                  <i aria-hidden="true">{burstPreset.icon}</i>{burstPreset.label}
                </span>
              ) : null}
            </div>
            <div className="versus">VS</div>
            <div className={`player-card black-player${game.you.color === "b" ? " you-player" : ""}`}>
              <span className="player-piece" aria-hidden="true">
                <ChessPiece type="p" color="b" />
              </span>
              <div>
                <small>BLACK{game.you.color === "b" ? " • YOU" : ""}</small>
                <strong>{game.players.black?.name ?? "Waiting…"}</strong>
                <span className="captured-by">
                  <small>CAPTURED</small>
                  <b>{lostPieces.w.length ? lostPieces.w.map((piece, index) => (
                    <i key={`black-captured-${piece}-${index}`} aria-label={`white ${CHESS_PIECE_NAMES[piece]}`}>
                      <ChessPiece type={piece} color="w" />
                    </i>
                  )) : "—"}</b>
                </span>
              </div>
              <span className="status-lamp" data-active={game.status === "active" && game.turn === "b" ? "true" : "false"} />
              {!reactionsHidden && reactionBurst?.senderColor === "b" && burstPreset ? (
                <span className="reaction-bubble" role="status" aria-live="polite">
                  <i aria-hidden="true">{burstPreset.icon}</i>{burstPreset.label}
                </span>
              ) : null}
            </div>
          </div>

          <div
            className={`turn-panel ${viewingHistory ? "history" : game.turn === game.you.color ? "mine" : "theirs"} ${game.status}${displayCheck && !viewingHistory ? " check" : ""}`}
          >
            <span>{viewingHistory ? "↶" : game.status === "completed" ? "⚑" : magicDraft ? "✦" : displayCheck ? "!" : "◆"}</span>
            <div
              className="turn-status-copy"
              ref={moveConfirmFallback}
              role={displayCheck && !viewingHistory ? "alert" : "status"}
              aria-live={displayCheck && !viewingHistory ? "assertive" : "polite"}
              aria-atomic="true"
              tabIndex={-1}
            >
              <small>{viewingHistory ? "MOVE HISTORY" : magicDraft ? "MAGIC MOVE" : displayCheck && game.status !== "completed" ? "CHECK" : "MATCH STATUS"}</small>
              <strong>{statusText}</strong>
            </div>
            {!viewingHistory && (busy || botThinking) ? <b>{ending ? "ENDING GAME…" : openingIntro ? "WHITE OPENING…" : botThinking ? "RIOT BOT THINKING…" : "LOCKING MOVE…"}</b> : null}
            <HistoryControls
              currentPly={visibleHistoryPly}
              latestPly={latestHistoryPly}
              viewingHistory={viewingHistory}
              unavailable={history.error}
              canStepBackFromDraft={Boolean(magicDraft)}
              onBack={stepHistoryBack}
              onForward={stepHistoryForward}
              onLive={returnToLive}
            />
          </div>
          {game.magicRules ? (
            <div className="magic-game-banner" role="note">
              <span aria-hidden="true">✦</span>
              <div>
                <strong>MAGIC RULES</strong>
                <small>{game.magicRules.labels.join(" · ")}</small>
              </div>
            </div>
          ) : null}
          {magicDraft ? (
            <div
              className="magic-turn-actions"
              role="group"
              aria-label={`Finish or cancel the ${CHESS_PIECE_NAMES[magicDraft.piece]} magic move`}
            >
              <button
                type="button"
                className="primary-button"
                disabled={busy || viewingHistory}
                onClick={() => requestMove(magicDraft.from, magicDraft.to)}
              >
                FINISH TURN
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={busy || viewingHistory}
                onClick={() => {
                  setMagicDraft(null);
                  setSelected(null);
                  setMessage("");
                }}
              >
                CANCEL
              </button>
            </div>
          ) : null}
          {game.deadlineAt ? (
            <TurnDeadline
              deadlineAt={game.deadlineAt}
              turnPaceDays={game.turnPaceDays ?? 3}
              yourTurn={game.turn === game.you.color}
            />
          ) : null}

          {game.claimableDraws.length > 0 ? (
            <div className="draw-claims" role="group" aria-label="Available draw claims">
              <span>DRAW AVAILABLE</span>
              {game.claimableDraws.map((claim) => (
                <button
                  type="button"
                  key={claim}
                  disabled={busy || viewingHistory}
                  onClick={() => void claimDraw(claim)}
                >
                  {claim === "threefold_repetition"
                    ? "CLAIM REPETITION"
                    : "CLAIM 50-MOVE DRAW"}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className="board-wrap"
            aria-busy={!viewingHistory && (busy || botThinking)}
            data-interactive={canMove ? "true" : "false"}
            data-history={viewingHistory ? "true" : "false"}
          >
            {finisher && !viewingHistory ? <CheckmateFinisher finisher={finisher} /> : null}
            <div
              className="chessboard"
              role="grid"
              aria-label={viewingHistory
                ? `Historical chess board, ${replayFrameLabel(historyFrame)}`
                : "Chess board"}
            >
              {squares.map((square, index) => {
                const piece = chess.get(square);
                const legal = legalMoves.some((move) => move.to === square);
                const capture = legal && Boolean(piece || legalMoves.some((move) => move.to === square && move.isEnPassant()));
                const isSelected = selected === square;
                const isLast = lastMoveEndpoints.includes(square);
                const isCheckedKing = checkedKingSquare === square;
                const isDragOver = drag?.moved && drag.over === square && legal;
                const effect = viewingHistory
                  ? undefined
                  : effects.find((candidate) => candidate.to === square);
                const file = square[0];
                const rank = square[1];
                const showRank = index % 8 === 0;
                const showFile = index >= 56;
                return (
                  <button
                    type="button"
                    role="gridcell"
                    aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${CHESS_PIECE_NAMES[piece.type]}` : " empty"}${isCheckedKing ? ", in check" : ""}${legal ? ", legal destination" : ""}`}
                    aria-disabled={!canMove}
                    aria-selected={isSelected}
                    data-square={square}
                    className={`square ${isDarkSquare(square) ? "dark-square" : "light-square"}${isSelected ? " selected" : ""}${isLast ? " last-move" : ""}${isCheckedKing ? " king-in-check" : ""}${legal ? capture ? " capture-target" : " legal-target" : ""}${isDragOver ? " drag-over" : ""}${effect?.capture ? " capture-impact" : ""}`}
                    key={square}
                    onClick={() => tapSquare(square)}
                    disabled={busy || botThinking || viewingHistory}
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
                        <ChessPiece type={piece.type} color={piece.color} />
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
          {reactionsAvailable ? (
            <ReactionPanel
              playerColor={game.you.color}
              whiteName={game.players.white.name}
              blackName={game.players.black?.name ?? "BLACK"}
              reactions={reactions}
              hidden={reactionsHidden}
              open={reactionOpen}
              busy={reactionSending}
              message={reactionMessage}
              postGame={game.status === "completed"}
              triggerRef={reactionTrigger}
              onToggleHidden={toggleReactionsHidden}
              onToggleOpen={() => setReactionOpen((current) => !current)}
              onSend={(key) => void sendReaction(key)}
            />
          ) : null}
          <details className="game-tools">
            <summary>
              <span>MORE</span>
              <b>Settings, actions, replay and move log</b>
            </summary>
            <div className="game-tools-content">
              <section className="side-card move-settings-card">
                <h2>MOVE SETTINGS</h2>
                <label className="move-confirm-setting">
                  <input
                    type="checkbox"
                    checked={confirmEveryMove}
                    onChange={(event) => toggleMoveConfirmation(event.currentTarget.checked)}
                  />
                  <span>
                    <strong>CONFIRM EVERY MOVE</strong>
                    <small>Ask “Are you sure?” before a move is sent. Stored in this browser.</small>
                  </span>
                  <b>{confirmEveryMove ? "ON" : "OFF"}</b>
                </label>
              </section>
              <section className="side-card actions-card">
                <h2>GAME ACTIONS</h2>
                <Link className="secondary-button" href="/app">NEW GAME</Link>
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
              <ReplayViewer
                moves={serverGame?.moves ?? game.moves}
                initialFen={serverGame?.initialFen ?? game.initialFen}
                orientation={game.you.color}
                magicRules={game.magicRules ?? null}
              />
              <section className="side-card moves-card">
                <div className="side-heading"><h2>MOVE LOG</h2><span>{game.plyCount} PLY</span></div>
                {game.moves.length === 0 ? <p className="empty-moves">No moves yet. White opens the riot.</p> : (
                  <ol className="move-list">
                    {Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => (
                      <li key={index}><span>{index + 1}.</span><b>
                        {game.moves[index * 2]
                          ? `${game.moves[index * 2].san}${game.moves[index * 2].second
                            ? ` → ${game.moves[index * 2].second!.san}`
                            : ""}`
                          : ""}
                      </b><b>
                        {game.moves[index * 2 + 1]
                          ? `${game.moves[index * 2 + 1].san}${game.moves[index * 2 + 1].second
                            ? ` → ${game.moves[index * 2 + 1].second!.san}`
                            : ""}`
                          : ""}
                      </b></li>
                    ))}
                  </ol>
                )}
              </section>
              <section className="side-card rules-card"><span aria-hidden="true">i</span><div><strong>GAME INFO</strong><small>
                {game.magicRules ? `Magic chess • ${game.magicRules.labels.join(" • ")} • ` : "Standard chess • "}
                {game.mode === "solo" && game.aiDifficulty
                  ? `Riot Bot level ${game.aiDifficulty} • ${DIFFICULTY_LABELS[game.aiDifficulty]}`
                  : `${game.turnPaceDays
                    ? `${game.turnPaceDays} ${game.turnPaceDays === 1 ? "day" : "days"} per move`
                    : "No turn deadline"} • Drag or tap • Every move saved`}
              </small></div></section>
            </div>
          </details>
        </aside>
      </section>

      {drag?.moved && draggedPiece ? (
        <span
          className={`drag-ghost piece-${draggedPiece.color}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <ChessPiece type={draggedPiece.type} color={draggedPiece.color} />
        </span>
      ) : null}

      {promotionMove ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-card"><p>PROMOTE YOUR PAWN</p><div>
            {(["q", "r", "b", "n"] as Promotion[]).map((piece) => (
              <button
                key={piece}
                aria-label={`Promote to ${CHESS_PIECE_NAMES[piece]}`}
                autoFocus={piece === "q"}
                onClick={() => requestMove(promotionMove.from, promotionMove.to, piece)}
              >
                <ChessPiece type={piece} color={game.you.color} />
              </button>
            ))}
          </div><button className="cancel-promotion" onClick={() => setPromotionMove(null)}>CANCEL</button></div>
        </div>
      ) : null}

      <dialog
        className="move-confirm-dialog"
        ref={moveConfirmDialog}
        aria-labelledby="move-confirm-title"
        aria-describedby="move-confirm-description"
        onCancel={(event) => {
          event.preventDefault();
          cancelMoveConfirmation();
        }}
        onClose={() => {
          setPendingMove(null);
          window.requestAnimationFrame(() => {
            const preferred = moveConfirmReturnFocus.current;
            const preferredIsReady = Boolean(
              preferred
              && preferred.isConnected
              && preferred !== document.body
              && !preferred.matches(":disabled,[aria-disabled='true']"),
            );
            const target = preferredIsReady ? preferred : moveConfirmFallback.current;
            target?.focus({ preventScroll: true });
            moveConfirmReturnFocus.current = null;
          });
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) cancelMoveConfirmation();
        }}
      >
        <div className="move-confirm-card">
          <small>MOVE CONFIRMATION</small>
          <h2 id="move-confirm-title">ARE YOU SURE?</h2>
          <p id="move-confirm-description">
            {pendingMove ? describeMoveIntent(pendingMove) : "Confirm this move?"}
          </p>
          <div>
            <button
              className="quiet-button"
              type="button"
              autoFocus
              onClick={cancelMoveConfirmation}
            >
              KEEP THINKING
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!pendingMove || busy || moveCommitInFlight.current}
              onClick={() => {
                if (pendingMove) void commitMove(pendingMove);
              }}
            >
              CONFIRM MOVE
            </button>
          </div>
        </div>
      </dialog>
    </main>
  );
}
