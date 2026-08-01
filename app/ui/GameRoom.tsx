"use client";

import { Chess, type Move, type Square } from "chess.js";
import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  boardEffects,
  moveBoardEffects,
  type BoardEffect,
} from "@/lib/game-effects";
import {
  analyzeMoveRisk,
  readChessCoachPreference,
  readTacticalCelebrationsPreference,
  type CoachWarning,
} from "@/lib/chess-coach";
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
  AUDIO_PREFERENCES_EVENT,
  classifyGameSounds,
  playGameSound,
  playGameSounds,
  readSoundPreference,
  unlockGameSounds,
  type AudioPreferences,
} from "@/lib/game-sounds";
import { copyInvitationLink } from "@/lib/invitation-copy";
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
import {
  optimisticMoveSnapshot,
  optimisticSoloTurnSnapshot,
  shouldAcceptGameSnapshot,
} from "@/lib/game-snapshots";
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
} from "@/lib/move-confirmation";
import type { DrawClaim, GameSnapshot, Promotion } from "@/lib/game-types";
import { gameVariant } from "@/lib/game-variants";
import {
  boardActionDuration,
  BoardActionAnimation,
} from "./BoardActionAnimation";
import { Brand } from "./Brand";
import { CapturedPiecesPanel } from "./CapturedPiecesPanel";
import { ChessPiece } from "./ChessPiece";
import { CheckmateFinisher } from "./CheckmateFinisher";
import { HistoryControls } from "./HistoryControls";
import { MoveHistoryPanel } from "./MoveHistoryPanel";
import { ReactionPanel } from "./ReactionPanel";
import { ResignationFinisher } from "./ResignationFinisher";
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
  const variant = gameVariant(game?.variantId);
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
  const [effectQueue, setEffectQueue] = useState<BoardEffect[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [historyPly, setHistoryPly] = useState<HistoryCursor>(null);
  const [confirmEveryMove, setConfirmEveryMove] = useState(false);
  const [chessCoachOn, setChessCoachOn] = useState(true);
  const [tacticalCelebrationsOn, setTacticalCelebrationsOn] = useState(true);
  const [pendingMove, setPendingMove] = useState<MoveIntent | null>(null);
  const [coachWarning, setCoachWarning] = useState<CoachWarning | null>(null);
  const [coachExplanationOpen, setCoachExplanationOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [surrendering, setSurrendering] = useState(false);
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
  const surrenderDialog = useRef<HTMLDialogElement | null>(null);
  const surrenderKeepPlaying = useRef<HTMLButtonElement | null>(null);
  const moveConfirmReturnFocus = useRef<HTMLElement | null>(null);
  const moveConfirmFallback = useRef<HTMLDivElement | null>(null);
  const moveCommitInFlight = useRef(false);
  const activeEffect = effectQueue[0] ?? null;
  const activeEffectFinalSquare = activeEffect
    ? effectQueue.filter((effect) => effect.ply === activeEffect.ply).at(-1)?.to
      ?? activeEffect.to
    : null;
  const celebrateActiveEffect = Boolean(
    tacticalCelebrationsOn
    && activeEffect?.attacker?.color === game?.you.color,
  );
  const postGameReactionsOpen = Boolean(
    game?.status === "completed"
    && postGameReactionWindowOpen(game.updatedAt),
  );

  useEffect(() => {
    if (!game) return;
    window.dispatchEvent(new CustomEvent("chessriot:game-menu-state", {
      detail: { status: game.status },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("chessriot:game-menu-state", { detail: null }));
    };
  }, [game]);

  useEffect(() => {
    const syncAudio = (event: Event) => {
      setSoundOn((event as CustomEvent<AudioPreferences>).detail.effectsOn);
    };
    const surrenderFromMenu = () => setConfirmEnd(true);
    const syncCoach = (event: Event) => setChessCoachOn(Boolean((event as CustomEvent<boolean>).detail));
    const syncCelebrations = (event: Event) => setTacticalCelebrationsOn(Boolean((event as CustomEvent<boolean>).detail));
    const syncMoveConfirmation = (event: Event) => setConfirmEveryMove(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(AUDIO_PREFERENCES_EVENT, syncAudio);
    window.addEventListener("chessriot:surrender", surrenderFromMenu);
    window.addEventListener("chessriot:coach-preference", syncCoach);
    window.addEventListener("chessriot:celebrations-preference", syncCelebrations);
    window.addEventListener("chessriot:move-confirmation-preference", syncMoveConfirmation);
    return () => {
      window.removeEventListener(AUDIO_PREFERENCES_EVENT, syncAudio);
      window.removeEventListener("chessriot:surrender", surrenderFromMenu);
      window.removeEventListener("chessriot:coach-preference", syncCoach);
      window.removeEventListener("chessriot:celebrations-preference", syncCelebrations);
      window.removeEventListener("chessriot:move-confirmation-preference", syncMoveConfirmation);
    };
  }, []);

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
      if (document.visibilityState !== "visible") return;
      setEffectQueue(moveBoardEffects(openingMove, nextGame.initialFen));
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
        setEffectQueue([]);
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
  }, [
    acceptGame,
    beginOpeningIntro,
    gameId,
    setPendingMove,
    setPromotionMove,
  ]);

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
    setChessCoachOn(readChessCoachPreference());
    setTacticalCelebrationsOn(readTacticalCelebrationsPreference());
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
    const markerKey = `chessriot:sound:last-version:${gameId}`;
    if (!previous) {
      try {
        sessionStorage.setItem(markerKey, String(game.version));
      } catch {
        // The in-memory previous snapshot still prevents replay in this view.
      }
      return;
    }
    const sounds = classifyGameSounds(previous, game);
    if (!sounds.length || !soundOn) return;
    try {
      const lastPlayedVersion = Number(sessionStorage.getItem(markerKey) ?? "-1");
      if (lastPlayedVersion >= game.version) return;
      sessionStorage.setItem(markerKey, String(game.version));
    } catch {
      // Continue with in-memory deduplication when session storage is blocked.
    }
    playGameSounds(sounds);
  }, [game, gameId, optimisticGame, soundOn]);

  useEffect(() => {
    if (!game) return;
    const previous = previousEffectGame.current;
    const nextEffects = boardEffects(previous, game);
    previousEffectGame.current = game;
    if (historyPly !== null) {
      if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
      effectTimer.current = null;
      setEffectQueue([]);
      return;
    }
    if (reducedMotion) return;
    if (!nextEffects.length) {
      if (previous && game.plyCount < previous.plyCount) {
        if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
        effectTimer.current = null;
        setEffectQueue([]);
      }
      return;
    }
    if (document.visibilityState !== "visible") return;
    setEffectQueue((current) => {
      const queued = new Set(current.map((effect) => effect.id));
      const unseen = nextEffects.filter((effect) => !queued.has(effect.id));
      return [...current, ...unseen].slice(-12);
    });
  }, [game, historyPly, reducedMotion]);

  const finishBoardEffect = useCallback((effectId: string) => {
    setEffectQueue((current) => current[0]?.id === effectId
      ? current.slice(1)
      : current);
  }, []);

  const dismissBoardEffects = useCallback(() => {
    if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    effectTimer.current = null;
    setEffectQueue([]);
  }, []);

  useEffect(() => {
    if (reducedMotion) dismissBoardEffects();
  }, [dismissBoardEffects, reducedMotion]);

  useEffect(() => {
    if (!activeEffect) return;
    if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
    effectTimer.current = window.setTimeout(() => {
      effectTimer.current = null;
      finishBoardEffect(activeEffect.id);
    }, boardActionDuration(activeEffect, reducedMotion, celebrateActiveEffect) + 120);
    return () => {
      if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
      effectTimer.current = null;
    };
  }, [activeEffect, celebrateActiveEffect, finishBoardEffect, reducedMotion]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const stopHiddenAnimation = () => {
      if (document.visibilityState === "hidden") dismissBoardEffects();
    };
    document.addEventListener("visibilitychange", stopHiddenAnimation);
    return () => document.removeEventListener("visibilitychange", stopHiddenAnimation);
  }, [dismissBoardEffects]);

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
    const dialog = surrenderDialog.current;
    if (!dialog) return;
    if (confirmEnd && !dialog.open) {
      dialog.showModal();
      surrenderKeepPlaying.current?.focus();
    } else if (!confirmEnd && dialog.open) {
      dialog.close();
    }
  }, [confirmEnd]);

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
  }, [game, openingIntro]);
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
    () => capturedPiecesByVictimColor(presentedMoves, game?.initialFen),
    [game?.initialFen, presentedMoves],
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
    dismissBoardEffects();
    const piece = new Chess(game.fen).get(from)?.type ?? null;
    const intent: MoveIntent = {
      from,
      to,
      ...(promotion ? { promotion } : {}),
      ...(second ? { second } : {}),
      expectedVersion: game.version,
      piece,
    };
    const warning = chessCoachOn ? analyzeMoveRisk(game.fen, intent) : null;
    if (!confirmEveryMove && !warning) {
      void commitMove(intent);
      return;
    }
    moveConfirmReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setPromotionMove(null);
    setCoachWarning(warning);
    setCoachExplanationOpen(false);
    setPendingMove(intent);
  }

  function closeMoveConfirmation(): void {
    if (moveConfirmDialog.current?.open) moveConfirmDialog.current.close();
    setPendingMove(null);
    setCoachWarning(null);
    setCoachExplanationOpen(false);
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
    const requestId = generateUuid();
    const humanPreview = optimisticMoveSnapshot(
      currentGame,
      intent.from,
      intent.to,
      intent.promotion,
      { second: intent.second },
    );
    const authoritativeVersion = intent.expectedVersion;
    let botPreviewTimer: number | null = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setBusy(true);
    setMessage("");
    setSelected(null);
    setPromotionMove(null);
    setMagicDraft(null);
    if (humanPreview) {
      setOptimisticGame(humanPreview);
      if (humanPreview.mode === "solo" && humanPreview.status === "active") {
        botPreviewTimer = window.setTimeout(() => {
          const fullPreview = optimisticSoloTurnSnapshot(
            currentGame,
            intent.from,
            intent.to,
            requestId,
            intent.promotion,
            {
              ...(intent.second ? { second: intent.second } : {}),
              createdAt: humanPreview.updatedAt,
            },
          );
          if (
            fullPreview
            && moveCommitInFlight.current
            && latestVersion.current === authoritativeVersion
          ) {
            setOptimisticGame(fullPreview);
          }
        }, 100);
      }
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
          requestId,
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
      if (botPreviewTimer !== null) window.clearTimeout(botPreviewTimer);
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
    setEffectQueue([]);
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

  async function copyInvite() {
    if (!inviteUrl) return;
    const markCopied = () => {
      setInviteShared(true);
      window.setTimeout(() => setInviteShared(false), 2_000);
    };
    if (await copyInvitationLink(inviteUrl, navigator.clipboard)) {
      markCopied();
      return;
    }
    setMessage("Clipboard access is unavailable. Select and copy the invitation link below.");
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
    let finisherStartedAt: number | null = null;
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
      if (!response.ok || !data.game) {
        setMessage(apiErrorMessage(data, "Could not end the game"));
        return;
      }
      // Remove the modal/top-layer backdrop before mounting the board finisher.
      surrenderDialog.current?.close();
      setConfirmEnd(false);
      if (game.status === "active") {
        finisherStartedAt = Date.now();
        setSurrendering(true);
      }
      acceptGame(data.game);
    } catch {
      setMessage("Could not end the game. Refreshing the board…");
      await loadGame(latestVersion.current);
    } finally {
      if (finisherStartedAt !== null) {
        const minimum = reducedMotion ? 120 : 1_000;
        const remaining = Math.max(0, minimum - (Date.now() - finisherStartedAt));
        if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setBusy(false);
      setEnding(false);
      setSurrendering(false);
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
      </header>
      <dialog
        className="surrender-confirm-backdrop"
        ref={surrenderDialog}
        aria-labelledby="surrender-title"
        aria-describedby="surrender-description"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setConfirmEnd(false);
        }}
        onClose={() => setConfirmEnd(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirmEnd(false);
        }}
      >
          <section className="surrender-confirm">
            <span aria-hidden="true">⚑</span>
            <h2 id="surrender-title">{game.status === "waiting" ? "Cancel game?" : "Surrender?"}</h2>
            <p id="surrender-description">{game.status === "waiting"
              ? "The invitation will stop working."
              : "Your king will raise the white flag and your opponent wins."}</p>
            <button className="danger-button" type="button" disabled={busy} onClick={() => void endGame()}>
              {busy ? "ENDING…" : game.status === "waiting" ? "CANCEL GAME" : "RAISE WHITE FLAG"}
            </button>
            <button
              className="quiet-button"
              type="button"
              ref={surrenderKeepPlaying}
              disabled={busy}
              onClick={() => setConfirmEnd(false)}
            >
              KEEP PLAYING
            </button>
          </section>
      </dialog>
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
            {!viewingHistory && (ending || openingIntro || botThinking) ? <b>{ending ? "ENDING GAME…" : openingIntro ? "WHITE OPENING…" : "RIOT BOT THINKING…"}</b> : null}
            <HistoryControls
              currentPly={visibleHistoryPly}
              viewingHistory={viewingHistory}
              unavailable={history.error}
              canStepBackFromDraft={Boolean(magicDraft)}
              onBack={stepHistoryBack}
              onForward={stepHistoryForward}
            />
          </div>
          {game.variantId !== "standard" ? (
            <div className="variant-game-banner" role="note">
              <span aria-hidden="true">{variant.icon}</span>
              <div>
                <strong>{variant.group === "mating-set" ? "MATING SET" : "MINI GAME"} · {variant.name.toUpperCase()}</strong>
                <small>{variant.group === "mating-set"
                  ? `${variant.loadout} · You command White · Checkmate wins`
                  : `${variant.loadout} · Normal chess moves · Checkmate wins`}</small>
              </div>
            </div>
          ) : null}
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
            {surrendering && !viewingHistory
              ? <ResignationFinisher color={game.you.color} />
              : null}
            {finisher && !viewingHistory && !activeEffect
              ? <CheckmateFinisher finisher={finisher} />
              : null}
            <div
              className="chessboard"
              role="grid"
              onPointerDownCapture={() => {
                if (canMove && activeEffect) dismissBoardEffects();
              }}
              onKeyDownCapture={() => {
                if (canMove && activeEffect) dismissBoardEffects();
              }}
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
                const combatPieceHidden = Boolean(
                  !viewingHistory
                  && activeEffect
                  && activeEffectFinalSquare === square,
                );
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
                    className={`square ${isDarkSquare(square) ? "dark-square" : "light-square"}${isSelected ? " selected" : ""}${isLast ? " last-move" : ""}${isCheckedKing ? " king-in-check" : ""}${legal ? capture ? " capture-target" : " legal-target" : ""}${isDragOver ? " drag-over" : ""}`}
                    key={square}
                    onClick={() => tapSquare(square)}
                    disabled={busy || botThinking || viewingHistory}
                  >
                    {showRank ? <span className="rank-label">{rank}</span> : null}
                    {showFile ? <span className="file-label">{file}</span> : null}
                    {piece ? (
                      <span
                        className={`piece piece-${piece.color}${drag?.from === square && drag.moved ? " dragging" : ""}${combatPieceHidden ? " combat-piece-hidden" : ""}`}
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
              {activeEffect && !viewingHistory ? (
                <BoardActionAnimation
                  effect={activeEffect}
                  squares={squares}
                  reducedMotion={reducedMotion}
                  tacticalCelebrations={celebrateActiveEffect}
                  onComplete={() => finishBoardEffect(activeEffect.id)}
                />
              ) : null}
            </div>
          </div>
          {message ? <p className="board-message" role="status">{message}</p> : null}
        </div>

        <aside className="game-sidebar">
          {game.status === "waiting" ? (
            <section className="side-card invite-card">
              <span className="side-icon">⌁</span><h2>INVITE PLAYER 2</h2>
              <p>Send this private link. The first person to submit it claims Black.</p>
              {inviteUrl ? <><button className="primary-button" onClick={() => void copyInvite()}>{inviteShared ? "COPIED ✓" : "COPY INVITATION LINK"}</button>
                <input className="invite-field" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Invitation link" /></> :
                <p className="form-error">The invitation link is no longer stored on this device.</p>}
            </section>
          ) : null}
          <CapturedPiecesPanel
            whiteCaptured={lostPieces.w}
            blackCaptured={lostPieces.b}
          />
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
          <MoveHistoryPanel
            moves={game.moves}
            currentPly={visibleHistoryPly}
          />
          <section className="side-card rules-card"><span aria-hidden="true">i</span><div><strong>GAME INFO</strong><small>
            {game.magicRules
              ? `Magic chess • ${game.magicRules.labels.join(" • ")} • `
              : `${variant.name} • ${game.variantId === "standard" ? "Standard setup" : "Mini Game"} • `}
            {game.mode === "solo" && game.aiDifficulty
              ? `Riot Bot level ${game.aiDifficulty} • ${DIFFICULTY_LABELS[game.aiDifficulty]}`
              : `${game.turnPaceDays
                ? `${game.turnPaceDays} ${game.turnPaceDays === 1 ? "day" : "days"} per move`
                : "No turn deadline"} • Drag or tap • Every move saved`}
          </small></div></section>
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
          <small>{coachWarning ? "CHESS COACH" : "MOVE CONFIRMATION"}</small>
          <h2 id="move-confirm-title">ARE YOU SURE?</h2>
          <p id="move-confirm-description">
            {pendingMove ? describeMoveIntent(pendingMove) : "Confirm this move?"}
          </p>
          {coachWarning ? (
            <div className="coach-warning">
              <button
                type="button"
                aria-expanded={coachExplanationOpen}
                aria-controls="coach-risk-explanation"
                onClick={() => setCoachExplanationOpen((current) => !current)}
              >
                {coachExplanationOpen ? "HIDE EXPLANATION" : "WHY IS THIS RISKY?"}
              </button>
              {coachExplanationOpen ? (
                <p id="coach-risk-explanation" role="status">{coachWarning.explanation}</p>
              ) : null}
            </div>
          ) : null}
          <div className="move-confirm-actions">
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
              disabled={!pendingMove || busy}
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
