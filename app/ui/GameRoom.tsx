"use client";

import { hasMagicRule } from "@/lib/magic-rules";
import { createBoardPinchGuard } from "@/lib/board-gestures";

import { useLanguage } from "./LanguageProvider";


import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import Link from "next/link";
import { useOptionalAccountSession } from "./AccountGate";
import { takeGamePrefetch } from "@/lib/game-prefetch";
import { NotificationTurnTest } from "./NotificationTurnTest";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
import { publishAuthSessionInvalidated } from "@/lib/auth-session-client";
import { listenForGameTurnPush } from "@/lib/game-push-refresh";
import {
  fetchJsonWithReadTimeout,
  gamePollingIntervalMs,
  recoveryDelayMs,
  type NetworkInformationLike,
} from "@/lib/client-recovery";
import { readApiJson, requestHeaders } from "@/lib/client-http";
import {
  generateUuid,
  hasSeatTokenInHash,
  inviteKey,
  playerKey,
  privateGamePath,
  readInvitationUrlFromHash,
  readSeatTokenFromHash,
  removeInvitationFromHash,
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
import { canPlayPendingOpening } from "@/lib/pending-opening";
import { PendingInvitation } from "./PendingInvitation";
import {
  actionEndpointSquares,
  capturedPiecesByVictimColor,
  CHESS_PIECE_NAMES,
  DIFFICULTY_LABELS,
  checkedKingSquare as findCheckedKingSquare,
  gameStatusText,
  illegalDestinationMessage,
  isDarkSquare,
  orientedBoardSquares,
  pieceCannotAnswerCheckMessage,
} from "@/lib/game-presentation";
import { classifyGameFinisher, type GameFinisher } from "@/lib/game-finishers";
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
  replayFrameLabelParts,
  resolvedHistoryPly,
  type HistoryCursor,
} from "@/lib/game-replay";
import { legalMagicMoves, magicContinuationStep } from "@/lib/game-rules";
import { magicMoveLimit, magicRuleLabel, type MagicPiece } from "@/lib/magic-rules";
import { magicDraftTapDecision } from "@/lib/magic-turn-ui";
import {
  describeMoveIntentParts,
  moveIntentStillValid,
  readMoveConfirmationPreference,
  type MoveIntent,
} from "@/lib/move-confirmation";
import { mayClearTurnNotification } from "@/lib/pwa";
import type { DrawClaim, GameSnapshot, Promotion } from "@/lib/game-types";
import { gameVariant, type GameVariantId } from "@/lib/game-variants";
import {
  consumeGameEntryNotice,
  waitingUiBecameStale,
  type GameEntryNotice,
} from "@/lib/game-room-entry";
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
import { PlayerClock } from "./PlayerClock";
import { PostGamePanel } from "./PostGamePanel";
import { ResignationFinisher } from "./ResignationFinisher";
import { TurnDeadline } from "./TurnDeadline";
import { PERFORMANCE_MODE_EVENT } from "./PerformanceMode";

const CONNECTION_MESSAGE = "Connection lost. Reconnecting…";
const FINISHER_DURATION_MS = 2_200;
const REDUCED_FINISHER_DURATION_MS = 700;
const OPENING_INTRO_DURATION_MS = 360;
const VARIANT_LABELS: Record<GameVariantId, { name: string; loadout: string }> = {
  standard: { name: "Classic chess", loadout: "Full army" },
  "pawn-riot": { name: "Pawn Riot", loadout: "King and eight pawns" },
  "half-army": { name: "Half Army", loadout: "Half the pieces" },
  "pawn-duel": { name: "Pawn Duel", loadout: "King and three pawns" },
  "mate-pawn": { name: "Pawn Promotion", loadout: "King and pawn vs. king" },
  "mate-rook": { name: "Rook Checkmate", loadout: "King and rook vs. king" },
  "mate-two-bishops": { name: "Two-Bishop Checkmate", loadout: "King and two bishops vs. king" },
};
const SIDE_PANEL_LABELS: Record<SidePanel, string> = {
  invite: "Invite",
  captures: "Captured pieces",
  history: "Moves",
  info: "Info",
};

function samePieceAgain(piece: PieceSymbol): string {
  return `Move the ${CHESS_PIECE_NAMES[piece]} again, or end your turn.`;
}

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
  promotion?: Promotion;
  pieceSquare: Square;
  piece: MagicPiece;
  initialPiece: MagicPiece;
  continuation: Array<{
    from: Square;
    to: Square;
    promotion?: Promotion;
  }>;
  maxMoves: number;
  fen: string;
}

interface PendingPromotion {
  from: Square;
  to: Square;
  continuation?: boolean;
  premove?: boolean;
}

type SidePanel = "invite" | "captures" | "history" | "info";
type LoadGameResult = "ready" | "unchanged" | "denied" | "error";

function TestGameDetails({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { t } = useLanguage();
  return enabled
    ? <details className="notification-test-game"><summary>{t("View test game")}</summary>{children}</details>
    : <>{children}</>;
}

export function GameRoom({ gameId }: { gameId: string }) {
  const { locale, dir, t } = useLanguage();
  const accountUsername = useOptionalAccountSession()?.username ?? null;
  const [serverGame, setServerGame] = useState<GameSnapshot | null>(null);
  const [optimisticGame, setOptimisticGame] = useState<GameSnapshot | null>(null);
  const game = optimisticGame ?? serverGame;
  const variant = gameVariant(game?.variantId);
  const [selected, setSelected] = useState<Square | null>(null);
  const [premoveDraft, setPremoveDraft] = useState<{ from: Square; to: Square; promotion?: Promotion } | null>(null);
  const premoveRevision = useRef(0);
  const [promotionMove, setPromotionMove] = useState<PendingPromotion | null>(null);
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
  const [finisher, setFinisher] = useState<GameFinisher | null>(null);
  const [postGameDismissed, setPostGameDismissed] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel | null>(null);
  const [mobileToolsActive, setMobileToolsActive] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(3_000);
  const [focusedSquare, setFocusedSquare] = useState<Square>("a1");
  const latestVersion = useRef(-1);
  const authoritativeStatus = useRef<GameSnapshot["status"] | null>(null);
  const entryNotice = useRef<GameEntryNotice | null>(null);
  const previousGame = useRef<GameSnapshot | null>(null);
  const previousEffectGame = useRef<GameSnapshot | null>(null);
  const activeToken = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const effectTimer = useRef<number | null>(null);
  const openingIntroTimer = useRef<number | null>(null);
  const previousFinisherGame = useRef<GameSnapshot | null>(null);
  const finisherTimer = useRef<number | null>(null);
  const moveConfirmDialog = useRef<HTMLDialogElement | null>(null);
  const surrenderDialog = useRef<HTMLDialogElement | null>(null);
  const promotionDialog = useRef<HTMLDialogElement | null>(null);
  const surrenderKeepPlaying = useRef<HTMLButtonElement | null>(null);
  const moveConfirmReturnFocus = useRef<HTMLElement | null>(null);
  const moveConfirmFallback = useRef<HTMLDivElement | null>(null);
  const sidePanelClose = useRef<HTMLButtonElement | null>(null);
  const sidePanelTrigger = useRef<HTMLButtonElement | null>(null);
  const moveCommitInFlight = useRef(false);
  const gameReadInFlight = useRef<Promise<LoadGameResult> | null>(null);

  const pinchGuard = useMemo(() => createBoardPinchGuard(() => {
    dragRef.current = null;
    setDrag(null);
    setSelected(null);
  }), []);
  useEffect(() => {
    // A second finger may land outside the board; never turn it into a move.
    window.addEventListener("pointerdown", pinchGuard.onPointerDown, true);
    return () => window.removeEventListener("pointerdown", pinchGuard.onPointerDown, true);
  }, [pinchGuard]);

  const closeSidePanel = useCallback(() => {
    setSidePanel(null);
    window.requestAnimationFrame(() => {
      sidePanelTrigger.current?.focus({ preventScroll: true });
      sidePanelTrigger.current = null;
    });
  }, []);

  const openSidePanel = useCallback((panel: SidePanel, trigger: HTMLButtonElement) => {
    sidePanelTrigger.current = trigger;
    setSidePanel(panel);
  }, []);

  const trapSidePanelFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!mobileToolsActive || event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [mobileToolsActive]);
  const activeEffect = effectQueue[0] ?? null;
  const activeEffectFinalSquare = activeEffect
    ? effectQueue.filter((effect) => effect.ply === activeEffect.ply).at(-1)?.to
      ?? activeEffect.to
    : null;
  const celebrateActiveEffect = Boolean(
    tacticalCelebrationsOn
    && activeEffect?.attacker?.color === game?.you.color,
  );

  useEffect(() => {
    if (!game) return;
    window.dispatchEvent(new CustomEvent("chessriot:game-menu-state", {
      detail: { status: game.status, mode: game.mode },
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("chessriot:game-menu-state", { detail: null }));
    };
  }, [game]);

  useEffect(() => {
    if (!serverGame) return;
    const publishVisibleSnapshot = () => {
      if (!mayClearTurnNotification(document.visibilityState, document.hasFocus())) return;
      window.dispatchEvent(new CustomEvent("chessriot:authoritative-game-visible", {
        detail: { gameId, version: serverGame.version },
      }));
    };
    publishVisibleSnapshot();
    window.addEventListener("focus", publishVisibleSnapshot);
    window.addEventListener("pageshow", publishVisibleSnapshot);
    document.addEventListener("visibilitychange", publishVisibleSnapshot);
    return () => {
      window.removeEventListener("focus", publishVisibleSnapshot);
      window.removeEventListener("pageshow", publishVisibleSnapshot);
      document.removeEventListener("visibilitychange", publishVisibleSnapshot);
    };
  }, [gameId, serverGame]);

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
    if (!shouldAcceptGameSnapshot(latestVersion.current, nextGame.version)
      && !(nextGame.version === latestVersion.current && (nextGame.premove?.revision ?? 0) > premoveRevision.current)) return false;
    premoveRevision.current = nextGame.premove?.revision ?? 0;
    setPremoveDraft(null);
    const waitingUiIsStale = waitingUiBecameStale(
      authoritativeStatus.current,
      nextGame.status,
      entryNotice.current !== null,
    );
    latestVersion.current = nextGame.version;
    authoritativeStatus.current = nextGame.status;
    setServerGame(nextGame);
    setOptimisticGame(null);
    rememberGame(nextGame);
    setAccess("ready");
    if (waitingUiIsStale) {
      entryNotice.current = null;
      setMessage("");
      setSidePanel((current) => current === "invite" ? null : current);
    } else {
      setMessage((current) => current === CONNECTION_MESSAGE ? "" : current);
    }
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

  const loadGameUnsafe = useCallback(async (sinceVersion?: number): Promise<LoadGameResult> => {
    const hash = window.location.hash;
    const hashHasSeat = hasSeatTokenInHash(hash);
    const linkedToken = readSeatTokenFromHash(hash);
    let usingSavedAccess = hashHasSeat && !linkedToken;
    if (hashHasSeat && !linkedToken) setMessage("This private access link is invalid. Trying your saved access…");
    const previousToken = activeToken.current;
    let savedToken: string | null = null;
    try {
      savedToken = localStorage.getItem(playerKey(gameId));
    } catch {
      savedToken = null;
    }
    const candidates: Array<string | null> = [];
    for (const candidate of [null, linkedToken, previousToken, savedToken]) {
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }

    try {
      type GameReadPayload = {
        game?: GameSnapshot;
        error?: { code?: string };
      };
      let response: Response | null = null;
      let data: GameReadPayload | null = null;
      let token: string | null = null;
      for (let index = 0; index < candidates.length; index += 1) {
        token = candidates[index];
        const seatCandidateChanged = token !== previousToken;
        const suffix = sinceVersion === undefined || seatCandidateChanged
          ? ""
          : `?sinceVersion=${sinceVersion}&premoveRevision=${premoveRevision.current}`;
        const prefetched = sinceVersion === undefined && token === null ? takeGamePrefetch(gameId, accountUsername) : null;
        const result = await (prefetched?.catch(() => null) ?? Promise.resolve(null))
          ?? await fetchJsonWithReadTimeout<GameReadPayload>(`/api/games/${gameId}${suffix}`, {
          headers: requestHeaders(token),
          cache: "no-store",
        });
        response = result.response;
        data = result.data;
        const canTrySavedAccess = response.status === 404
          && index < candidates.length - 1;
        if (!canTrySavedAccess) break;
        if (token === linkedToken && linkedToken !== previousToken) {
          usingSavedAccess = true;
          setMessage("This private access link did not match. Trying your saved access…");
        }
      }
      if (!response) {
        setAccess("error");
        return "error";
      }
      if (response.status === 204) {
        setMessage((current) =>
          usingSavedAccess || current === CONNECTION_MESSAGE ? "" : current);
        return "unchanged";
      }
      if (response.status === 401) {
        publishAuthSessionInvalidated();
        setAccess("error");
        return "error";
      }
      if (!response.ok || !data?.game) {
        if (response.status === 404) {
          setAccess("denied");
          return "denied";
        }
        if (latestVersion.current < 0) setAccess("error");
        else setMessage(CONNECTION_MESSAGE);
        return "error";
      }
      const seatChanged = previousToken !== token;
      if (seatChanged) {
        latestVersion.current = -1;
        authoritativeStatus.current = null;
        setOptimisticGame(null);
        previousGame.current = null;
        previousEffectGame.current = null;
        setSelected(null);
        setPromotionMove(null);
        setEffectQueue([]);
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
      return "ready";
    } catch {
      if (latestVersion.current < 0) setAccess("error");
      else setMessage(CONNECTION_MESSAGE);
      return "error";
    }
  }, [
    accountUsername,
    acceptGame,
    beginOpeningIntro,
    gameId,
    setHistoryPly,
    setPendingMove,
    setPromotionMove,
  ]);

  const loadGame = useCallback((sinceVersion?: number): Promise<LoadGameResult> => {
    if (gameReadInFlight.current) return gameReadInFlight.current;
    const operation = loadGameUnsafe(sinceVersion);
    gameReadInFlight.current = operation;
    void operation.finally(() => {
      if (gameReadInFlight.current === operation) gameReadInFlight.current = null;
    });
    return operation;
  }, [loadGameUnsafe]);

  const refreshAfterMutation = useCallback(async (sinceVersion?: number) => {
    if (gameReadInFlight.current) await gameReadInFlight.current;
    return loadGame(sinceVersion);
  }, [loadGame]);

  useEffect(() => {
    let storedInvite = "";
    const transientInvite = readInvitationUrlFromHash(
      window.location.hash,
      window.location.origin,
    ) ?? "";
    try {
      storedInvite = localStorage.getItem(inviteKey(gameId)) ?? "";
      if (transientInvite) localStorage.setItem(inviteKey(gameId), transientInvite);
    } catch {
      // The fragment keeps the just-created invitation copyable in this view.
    }
    const resolvedInvite = storedInvite || transientInvite;
    setInviteUrl(resolvedInvite);
    const currentUrl = new URL(window.location.href);
    const consumed = consumeGameEntryNotice(currentUrl);
    const cleanUrl = new URL(consumed.path, window.location.origin);
    if (transientInvite) cleanUrl.hash = removeInvitationFromHash(cleanUrl.hash);
    const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
    const currentPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    if (cleanPath !== currentPath) {
      window.history.replaceState(window.history.state, "", cleanPath);
    }
    entryNotice.current = consumed.notice;
    if (consumed.notice === "challenge-sent") {
      setMessage("Challenge sent. Your game is saved; you can come back later.");
    } else if (consumed.notice === "invitation-created") {
      setMessage("Invite ready. Share the private link, then play your opening move or come back later.");
    }
    setSoundOn(readSoundPreference());
    setConfirmEveryMove(readMoveConfirmationPreference());
    setChessCoachOn(readChessCoachPreference());
    setTacticalCelebrationsOn(readTacticalCelebrationsPreference());
    void loadGame();
    const reloadSeat = () => void loadGame();
    window.addEventListener("chessriot:notification-open", reloadSeat);
    window.addEventListener("hashchange", reloadSeat);
    return () => { window.removeEventListener("hashchange", reloadSeat); window.removeEventListener("chessriot:notification-open", reloadSeat); };
  }, [gameId, loadGame]);

  useEffect(() => {
    if (access !== "error" || latestVersion.current >= 0) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | null = null;
    let recovering = false;
    const schedule = () => {
      timer = window.setTimeout(() => void recover(), recoveryDelayMs(attempt));
    };
    const recover = async () => {
      if (cancelled || recovering || document.visibilityState === "hidden") return;
      recovering = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      try {
        const result = await loadGame();
        if (!cancelled && result === "error") {
          attempt += 1;
          schedule();
        }
      } finally {
        recovering = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void recover();
    };
    schedule();
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [access, loadGame]);

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: NetworkInformationLike;
    }).connection;
    const update = () => setPollIntervalMs(gamePollingIntervalMs(connection));
    update();
    window.addEventListener(PERFORMANCE_MODE_EVENT, update);
    return () => window.removeEventListener(PERFORMANCE_MODE_EVENT, update);
  }, []);

  useEffect(() => {
    if (!game || game.status === "completed") return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadGame(latestVersion.current);
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refreshAfterMutation(latestVersion.current);
    };
    const stopPush = "serviceWorker" in navigator
      ? listenForGameTurnPush(navigator.serviceWorker, gameId,
        () => latestVersion.current,
        (version) => {
          // An older poll may still be in flight when the push arrives.
          void refreshAfterMutation(version);
        })
      : () => undefined;
    const timer = window.setInterval(refresh, pollIntervalMs);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", refresh);
      stopPush();
    };
  }, [game, gameId, loadGame, pollIntervalMs, refreshAfterMutation]);

  useEffect(() => {
    if (
      !game ||
      busy ||
      game.mode !== "solo" ||
      game.notificationTest ||
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
    if (!nextEffects.length) {
      if (previous && game.plyCount < previous.plyCount) {
        if (effectTimer.current !== null) window.clearTimeout(effectTimer.current);
        effectTimer.current = null;
        setEffectQueue([]);
      }
      return;
    }
    if (document.visibilityState !== "visible") return;
    const newestPly = nextEffects.at(-1)?.ply;
    const latestTurnEffects = nextEffects.filter((effect) => effect.ply === newestPly);
    setEffectQueue((current) => {
      const queued = new Set(current.map((effect) => effect.id));
      const unseen = latestTurnEffects.filter((effect) => !queued.has(effect.id));
      return [...current, ...unseen].slice(-6);
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
    const compactLayout = window.matchMedia("(max-width: 980px)");
    const updateLayout = () => setMobileToolsActive(compactLayout.matches);
    updateLayout();
    compactLayout.addEventListener("change", updateLayout);
    return () => compactLayout.removeEventListener("change", updateLayout);
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
    if (!serverGame) return;
    const previous = previousFinisherGame.current;
    previousFinisherGame.current = serverGame;
    const nextFinisher = classifyGameFinisher(previous, serverGame);
    if (!nextFinisher) return;
    if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
    setFinisher(nextFinisher);
  }, [serverGame]);

  useEffect(() => {
    if (!finisher || activeEffect) return;
    if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
    finisherTimer.current = window.setTimeout(() => {
      finisherTimer.current = null;
      setFinisher(null);
    }, reducedMotion ? REDUCED_FINISHER_DURATION_MS : FINISHER_DURATION_MS);
    return () => {
      if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
      finisherTimer.current = null;
    };
  }, [activeEffect, finisher, reducedMotion]);

  useEffect(() => () => {
    if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
  }, []);

  useEffect(() => {
    if (game?.status === "completed") setPostGameDismissed(false);
  }, [game?.id, game?.status]);

  useEffect(() => {
    if (!sidePanel) return;
    const focusFrame = window.requestAnimationFrame(() => {
      sidePanelClose.current?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSidePanel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeSidePanel, sidePanel]);

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
    const dialog = promotionDialog.current;
    if (!dialog) return;
    if (promotionMove && !dialog.open) dialog.showModal();
    if (!promotionMove && dialog.open) dialog.close();
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
    () => chess && (viewingHistory || game?.status !== "completed")
      ? findCheckedKingSquare(chess)
      : null,
    [chess, game?.status, viewingHistory],
  );

  const squares = useMemo(
    () => orientedBoardSquares(game?.you.color ?? "w"),
    [game?.you.color],
  );

  const canMove = Boolean(
    game
    && !game.notificationTest
    && !openingIntro
    && !viewingHistory
    && (game.status === "active" || canPlayPendingOpening(game, game.you.color))
    && game.turn === game.you.color
    && !busy,
  );
  const canPremove = Boolean(game && game.mode === "multiplayer" && game.status === "active"
    && game.turn !== game.you.color && !busy && !viewingHistory);
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

  async function savePremove(move: { from: string; to: string; promotion?: Promotion } | null) {
    if (!game || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${gameId}/premove`, {
        method: "PUT", headers: { ...requestHeaders(activeToken.current), "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), expectedVersion: game.version,
          expectedRevision: game.premove?.revision ?? 0, move }),
      });
      const data = await response.json() as { game?: GameSnapshot };
      if (data.game) acceptGame(data.game);
      if (!response.ok) setMessage("The position changed. Choose your planned move again.");
      else { setPremoveDraft(null); setSelected(null); setMessage(""); }
    } catch { setMessage("Could not save your planned move. Try again."); }
    finally { setBusy(false); }
  }

  function focusBoardSquare(square: Square) {
    setFocusedSquare(square);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-square="${square}"]`)
        ?.focus({ preventScroll: true });
    });
  }

  function handleSquareKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    square: Square,
  ) {
    const index = squares.indexOf(square);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") nextIndex = Math.min(63, index + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 8);
    else if (event.key === "ArrowDown") nextIndex = Math.min(63, index + 8);
    else if (event.key === "Home") nextIndex = Math.floor(index / 8) * 8;
    else if (event.key === "End") nextIndex = Math.floor(index / 8) * 8 + 7;
    else return;
    event.preventDefault();
    focusBoardSquare(squares[nextIndex]);
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
    continuation?: Array<{
      from: Square;
      to: Square;
      promotion?: Promotion;
    }>,
  ): void {
    if (!game || !canMove || moveCommitInFlight.current) return;
    dismissBoardEffects();
    const piece = new Chess(game.fen).get(from)?.type ?? null;
    const intent: MoveIntent = {
      from,
      to,
      ...(promotion ? { promotion } : {}),
      ...(continuation && continuation.length > 0 ? { continuation } : {}),
      expectedVersion: game.version,
      piece,
    };
    const warning = chessCoachOn ? analyzeMoveRisk(game.fen, intent, locale) : null;
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
      { continuation: intent.continuation },
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
      if (humanPreview.mode === "solo" && !currentGame.notificationTest && humanPreview.status === "active") {
        botPreviewTimer = window.setTimeout(() => {
          const fullPreview = optimisticSoloTurnSnapshot(
            currentGame,
            intent.from,
            intent.to,
            requestId,
            intent.promotion,
            {
              ...(intent.continuation
                ? { continuation: intent.continuation }
                : {}),
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
          ...(intent.continuation ? { continuation: intent.continuation } : {}),
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
        publishAuthSessionInvalidated();
        setAccess("error");
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
            ? illegalDestinationMessage(true, locale)
            : data.error?.code === "opening_requires_acceptance"
              ? "Your friend must accept before you can play a game-ending move."
              : "The move failed.",
        );
        if (data.error?.code !== "stale_position") playInvalidSound();
      } else if (!data.game) {
        setMessage("The move response was incomplete. Refreshing the board…");
        await refreshAfterMutation(latestVersion.current);
        if (latestVersion.current <= authoritativeVersion) setOptimisticGame(null);
      }
    } catch {
      setMessage("Could not send your move. Refreshing the board…");
      await refreshAfterMutation(latestVersion.current);
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
        setMessage("You cannot claim a draw right now.");
        playInvalidSound();
      }
    } catch {
      setMessage("Could not claim a draw. Refreshing the board…");
      await refreshAfterMutation(latestVersion.current);
    } finally {
      setBusy(false);
    }
  }

  function tryBoardMove(from: Square, to: Square) {
    if (!chess || !game || (!canMove && !canPremove)) return;
    if (canPremove) {
      if (from === to) { setSelected(from); return; }
      if (chess.get(from)?.type === "p" && /[18]$/.test(to) && !hasMagicRule(game.magicRules ?? null, "no_promotion")) {
        setPromotionMove({ from, to, premove: true });
      } else setPremoveDraft({ from, to });
      setSelected(null);
      return;
    }
    const targetMoves = legalMagicMoves(
      chess,
      game.magicRules ?? null,
      from,
    ).filter((move) => move.to === to);
    if (targetMoves.length === 0) {
      setSelected(from);
      setMessage(
        magicDraft
          ? samePieceAgain(magicDraft.piece)
          : illegalDestinationMessage(game.check, locale),
      );
      playInvalidSound();
      return;
    }
    if (magicDraft) {
      if (from !== magicDraft.pieceSquare) {
        setSelected(magicDraft.pieceSquare);
        setMessage(samePieceAgain(magicDraft.piece));
        playInvalidSound();
        return;
      }
      if (targetMoves.some((move) => Boolean(move.promotion))) {
        setPromotionMove({ from, to, continuation: true });
        return;
      }
      advanceMagicDraft(from, to);
      return;
    }
    if (targetMoves.some((move) => Boolean(move.promotion))) {
      setPromotionMove({ from, to });
      return;
    }
    stageFirstMove(from, to);
  }

  function stageFirstMove(
    from: Square,
    to: Square,
    promotion?: Promotion,
  ): void {
    if (!game) return;
    const start = new Chess(game.fen);
    const firstMove = legalMagicMoves(
      start,
      game.magicRules ?? null,
      from,
    ).find((move) =>
      move.to === to && (move.promotion ?? undefined) === promotion);
    if (!firstMove) {
      setMessage("That move is not legal.");
      playInvalidSound();
      return;
    }
    start.move(firstMove);
    const sequence = {
      initialPiece: firstMove.piece,
      maxMoves: magicMoveLimit(game.magicRules, firstMove.piece),
    };
    const next = magicContinuationStep(
      start,
      firstMove.to,
      firstMove.color,
      game.magicRules ?? null,
      1,
      sequence,
    );
    if (!next) {
      requestMove(from, to, promotion);
      return;
    }
    setMagicDraft({
      from,
      to,
      ...(promotion ? { promotion } : {}),
      pieceSquare: firstMove.to,
      piece: next.piece,
      initialPiece: sequence.initialPiece,
      continuation: [],
      maxMoves: sequence.maxMoves,
      fen: next.chess.fen(),
    });
    setSelected(firstMove.to);
    setPromotionMove(null);
    setMessage(
      samePieceAgain(next.piece),
    );
  }

  function advanceMagicDraft(
    from: Square,
    to: Square,
    promotion?: Promotion,
  ): void {
    if (!magicDraft || !game) return;
    const staged = new Chess(magicDraft.fen);
    const selectedMove = legalMagicMoves(
      staged,
      game.magicRules ?? null,
      from,
    ).find((move) =>
      move.to === to && (move.promotion ?? undefined) === promotion);
    if (!selectedMove) {
      setMessage("That magic move is not legal.");
      playInvalidSound();
      return;
    }
    staged.move(selectedMove);
    const nextContinuation = [
      ...magicDraft.continuation,
      {
        from,
        to,
        ...(promotion ? { promotion } : {}),
      },
    ];
    const next = magicContinuationStep(
      staged,
      selectedMove.to,
      selectedMove.color,
      game.magicRules ?? null,
      nextContinuation.length + 1,
      {
        initialPiece: magicDraft.initialPiece,
        maxMoves: magicDraft.maxMoves,
      },
    );
    if (!next) {
      requestMove(
        magicDraft.from,
        magicDraft.to,
        magicDraft.promotion,
        nextContinuation,
      );
      return;
    }
    setMagicDraft({
      ...magicDraft,
      pieceSquare: selectedMove.to,
      piece: next.piece,
      continuation: nextContinuation,
      fen: next.chess.fen(),
    });
    setSelected(selectedMove.to);
    setPromotionMove(null);
    setMessage(
      `Magic move ${nextContinuation.length + 1} of ${next.maxMoves}. ${samePieceAgain(next.piece)}`,
    );
  }

  function tapSquare(square: Square) {
    if (pinchGuard.blocksMoves()) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (soundOn) void unlockGameSounds();
    if (!chess || !game) return;
    if (canPremove) {
      if (selected) tryBoardMove(selected, square);
      else if (chess.get(square)?.color === game.you.color) setSelected(square);
      return;
    }
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
        setMessage(samePieceAgain(magicDraft.piece));
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
        setMessage(pieceCannotAnswerCheckMessage(locale));
        playInvalidSound();
        return;
      }
      setSelected(square);
      setMessage("");
    } else if (selected) {
      setMessage(illegalDestinationMessage(game.check, locale));
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
    if (!event.isPrimary || pinchGuard.blocksMoves()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A second tap can target our own occupied square for a future recapture.
    if (canPremove && selected && selected !== square) return;
    if (!chess || !game || (!canMove && !canPremove) || chess.get(square)?.color !== game.you.color) return;
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
        ? illegalDestinationMessage(true, locale)
        : "Drop the piece on a highlighted square.");
      playInvalidSound();
    }
  }

  function cancelPieceDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    setSelected(null);
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
    setMessage("Clipboard access is unavailable. Select and copy the invite link below.");
  }

  async function answerWaitingChallenge(action: "accept" | "decline") {
    if (!game || game.status !== "waiting" || game.you.color !== "b") return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}/challenge`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: requestHeaders(activeToken.current, true),
        body: JSON.stringify({ action, requestId: generateUuid() }),
      });
      const payload = await readApiJson(response) as {
        game?: GameSnapshot;
        error?: { message?: unknown };
      } | null;
      if (!response.ok || !payload?.game) {
        throw new Error(t("Could not update the challenge."));
      }
      if (action === "decline") {
        window.location.assign("/app");
        return;
      }
      acceptGame(payload.game);
      setSidePanel(null);
      setMessage("Challenge accepted. The game has started.");
    } catch {
      setMessage("Could not update the challenge.");
    } finally {
      setBusy(false);
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
        setMessage("Could not end the game.");
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
      await refreshAfterMutation(latestVersion.current);
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
    return <main className="game-shell" lang={locale} dir={dir} translate="no"><header className="topbar"><Brand locale={locale} /></header><div className="loading-block"><span>{t("Setting up the board…")}</span><Link className="secondary-button" href="/">{t("Back to games")}</Link></div></main>;
  }
  if (access === "error") {
    return (
      <main className="join-shell" lang={locale} dir={dir} translate="no"><header className="topbar"><Brand locale={locale} /></header><section className="join-stage">
        <div className="voxel-card state-card"><span className="big-glyph">↻</span><h1>{t("Connection lost")}</h1>
          <p>{t("We could not load the game yet. ChessRiot will keep trying automatically.")}</p>
          <button className="secondary-button" type="button" onClick={() => {
            setAccess("loading");
            void loadGame();
          }}>{t("Try again")}</button>
          <Link className="quiet-button" href="/">{t("Back to games")}</Link>
        </div>
      </section></main>
    );
  }
  if (access === "denied") {
    return (
      <main className="join-shell" lang={locale} dir={dir} translate="no"><header className="topbar"><Brand locale={locale} /></header><section className="join-stage">
        <div className="voxel-card state-card"><span className="big-glyph">⌁</span><h1>{t("This game is not in your account")}</h1>
          <p>{t("Use the invite sent to this Google account, or ask your friend to send a new challenge.")}</p>
          <Link className="secondary-button" href="/">{t("Back to your games")}</Link>
        </div>
      </section></main>
    );
  }
  if (!game || !chess) return null;

  // Keep clocks tied to the latest server snapshot. Optimistic board moves may
  // change the displayed turn before the authoritative elapsed totals arrive.
  const clockGame = serverGame ?? game;
  const displayCheck = viewingHistory
    ? chess.isCheck()
    : game.status !== "completed" && game.check;
  const statusText = gameStatusText({
    game,
    viewingHistory,
    historyLabel: replayFrameLabel(historyFrame, locale),
    openingIntro,
    magicPiece: magicDraft?.piece,
    displayCheck,
    locale,
  });
  const historyStatusParts = replayFrameLabelParts(historyFrame, locale);
  const pendingMoveDescription = pendingMove
    ? describeMoveIntentParts(pendingMove, locale)
    : null;
  const draggedPiece = drag ? chess.get(drag.from) : null;
  return (
    <main className="game-shell" lang={locale} dir={dir} translate="no" data-notification-test={Boolean(game?.notificationTest)} data-pending-invitation={game.status === "waiting" && game.you.color === "w"}>
      <header className="topbar game-topbar">
        <Brand locale={locale} />
      </header>
      {game.notificationTest ? <NotificationTurnTest game={game} onRefresh={() => void loadGame()} /> : null}
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
            <h2 id="surrender-title">{game.status === "waiting" ? t("Cancel this game?") : t("Resign?")}</h2>
            <p id="surrender-description">{game.status === "waiting"
              ? t("The invite link will stop working.")
              : t("Your king will raise a white flag and your opponent will win.")}</p>
            <button className="danger-button" type="button" disabled={busy} onClick={() => void endGame()}>
              {busy ? t("Ending…") : game.status === "waiting" ? t("Cancel game") : t("Raise the white flag")}
            </button>
            <button
              className="quiet-button"
              type="button"
              ref={surrenderKeepPlaying}
              disabled={busy}
              onClick={() => setConfirmEnd(false)}
            >{t("Keep playing")}{" "}</button>
          </section>
      </dialog>
      {canPremove || game.premove?.move ? <aside className="premove-panel" role="status">
        <strong>{t("Plan your next move")}</strong>
        <p>{premoveDraft || game.premove?.move
          ? t("Plays automatically after your opponent moves, only if legal.")
          : t("Select your piece and destination while your opponent thinks. You can plan a recapture onto your own piece.")}</p>
        {premoveDraft ? <><bdi dir="ltr">{premoveDraft.from} → {premoveDraft.to}{premoveDraft.promotion ? `=${premoveDraft.promotion.toUpperCase()}` : ""}</bdi>
          <button disabled={busy} onClick={() => void savePremove(premoveDraft)}>{t("Save planned move")}</button>
          <button onClick={() => setPremoveDraft(null)}>{t("Cancel")}</button></> : game.premove?.move ? <>
          <bdi dir="ltr">{game.premove.move.from} → {game.premove.move.to}</bdi>
          <span>{t("Planned move saved. You can close the app.")}</span>
          <button disabled={busy} onClick={() => void savePremove(null)}>{t("Cancel planned move")}</button>
        </> : null}
      </aside> : game.status === "active" && game.premove?.status === "invalid" && game.turn === game.you.color ? <p role="status">{t("Your planned move was not legal after your opponent’s move. Choose another move.")}</p> : null}
      <TestGameDetails enabled={Boolean(game.notificationTest)}>
      <section className="game-layout" dir="ltr">
        <div
          className="board-column"
          dir={dir}
          aria-hidden={mobileToolsActive && sidePanel ? true : undefined}
          inert={mobileToolsActive && sidePanel ? true : undefined}
        >
          <PendingInvitation game={serverGame ?? game} busy={busy} inviteUrl={inviteUrl} inviteShared={inviteShared}
            onCopy={() => void copyInvite()} onPlay={() => {
              closeSidePanel(); setMessage(""); focusBoardSquare("e2");
              document.querySelector(".board-wrap")?.scrollIntoView({ block: "center", behavior: "smooth" });
            }} />
          <div className="match-banner" dir={dir}>
            <div className={`player-card white-player${game.you.color === "w" ? " you-player" : ""}`} dir="ltr">
              <span className="player-piece" aria-hidden="true">
                <ChessPiece type="p" color="w" />
              </span>
              <div className="player-card-copy" dir={dir}>
                <small>{t("White")}{game.you.color === "w" ? t(" • You") : ""}</small>
                <strong><bdi dir="auto">{game.players.white.name}</bdi></strong>
              </div>
              {!game.turnPaceDays ? <PlayerClock game={clockGame} color="w" /> : null}
            </div>
            <div className="versus">{t("vs.")}</div>
            <div className={`player-card black-player${game.you.color === "b" ? " you-player" : ""}`} dir="ltr">
              <span className="player-piece" aria-hidden="true">
                <ChessPiece type="p" color="b" />
              </span>
              <div className="player-card-copy" dir={dir}>
                <small>{t("Black")}{game.you.color === "b" ? t(" • You") : ""}</small>
                <strong>{game.players.black ? <bdi dir="auto">{game.players.black.name}</bdi> : t("Waiting…")}</strong>
              </div>
              {!game.turnPaceDays ? <PlayerClock game={clockGame} color="b" /> : null}
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
              <small>{viewingHistory ? t("Move history") : magicDraft ? t("Magic move") : displayCheck && game.status !== "completed" ? t("Check") : t("Game status")}</small>
              <strong>{viewingHistory
                ? historyStatusParts.map((part, index) => part.dir === "ltr"
                  ? <bdi dir="ltr" key={`${index}:${part.text}`}>{part.text}</bdi>
                  : <span key={`${index}:${part.text}`}>{part.text}</span>)
                : statusText}</strong>
            </div>
            {!viewingHistory && (ending || openingIntro || botThinking) ? <b>{ending ? t("Ending the game…") : openingIntro ? t("White moves first…") : t("Riot Bot is thinking…")}</b> : null}
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
                <strong>{variant.group === "mating-set" ? t("Checkmate practice") : t("Mini-game")} · {t(VARIANT_LABELS[variant.id].name)}</strong>
                <small>{variant.group === "mating-set"
                  ? t("${p0} · You play White · Checkmate wins", {p0: t(VARIANT_LABELS[variant.id].loadout)})
                  : t("${p0} · Standard chess moves · Checkmate wins", {p0: t(VARIANT_LABELS[variant.id].loadout)})}</small>
              </div>
            </div>
          ) : null}
          {magicDraft ? (
            <div
              className="magic-turn-actions"
              role="group"
              aria-label={t("Finish or cancel the ${p0} magic move", {p0: t(CHESS_PIECE_NAMES[magicDraft.piece])})}
            >
              <button
                type="button"
                className="primary-button"
                disabled={busy || viewingHistory}
                onClick={() => requestMove(
                  magicDraft.from,
                  magicDraft.to,
                  magicDraft.promotion,
                  magicDraft.continuation,
                )}
              >{t("End turn")}{" "}</button>
              <button
                type="button"
                className="quiet-button"
                disabled={busy || viewingHistory}
                onClick={() => {
                  setMagicDraft(null);
                  setSelected(null);
                  setMessage("");
                }}
              >{t("Cancel")}{" "}</button>
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
            <div className="draw-claims" role="group" aria-label={t("Available draw claims")}>
              <span>{t("You can claim a draw")}</span>
              {game.claimableDraws.map((claim) => (
                <button
                  type="button"
                  key={claim}
                  disabled={busy || viewingHistory}
                  onClick={() => void claimDraw(claim)}
                >
                  {claim === "threefold_repetition"
                    ? t("Claim draw: threefold repetition")
                    : t("Claim draw: 50-move rule")}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className="board-wrap"
            aria-busy={!viewingHistory && (busy || botThinking)}
            data-interactive={canMove || canPremove ? "true" : "false"}
            data-history={viewingHistory ? "true" : "false"}
          >
            {surrendering && !viewingHistory
              ? <ResignationFinisher color={game.you.color} locale={locale} />
              : null}
            {finisher && !viewingHistory && !activeEffect
              ? <CheckmateFinisher finisher={finisher} locale={locale} />
              : null}
            <div
              className="chessboard"
              dir="ltr"
              role="grid"
              onPointerDownCapture={() => {
                if (canMove && activeEffect) dismissBoardEffects();
              }}
              onKeyDownCapture={() => {
                pinchGuard.resumeWithKeyboard();
                if (canMove && activeEffect) dismissBoardEffects();
              }}
              aria-label={viewingHistory
                ? t("Chessboard replay, ${p0}", {p0: replayFrameLabel(historyFrame, locale)})
                : t("Chessboard")}
            >
              {squares.map((square, index) => {
                const piece = chess.get(square);
                const legal = legalMoves.some((move) => move.to === square);
                const capture = legal && Boolean(piece || legalMoves.some((move) => move.to === square && move.isEnPassant()));
                const planned = premoveDraft ?? game.premove?.move;
                const isPlanned = planned?.from === square || planned?.to === square;
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
                    aria-label={t("${p0}${p1}${p2}${p3}", {p0: square, p1: piece ? ` ${piece.color === "w" ? "White" : "Black"} ${CHESS_PIECE_NAMES[piece.type]}` : " empty", p2: isCheckedKing ? ", in check" : "", p3: legal ? ", legal destination" : ""})}
                    aria-disabled={!canMove && !canPremove}
                    aria-selected={isSelected}
                    tabIndex={focusedSquare === square ? 0 : -1}
                    data-square={square}
                    className={`square ${isDarkSquare(square) ? "dark-square" : "light-square"}${isSelected ? " selected" : ""}${isPlanned ? " premove-square" : ""}${isLast ? " last-move" : ""}${isCheckedKing ? " king-in-check" : ""}${legal ? capture ? " capture-target" : " legal-target" : ""}${isDragOver ? " drag-over" : ""}`}
                    key={square}
                    onFocus={() => setFocusedSquare(square)}
                    onKeyDown={(event) => handleSquareKeyDown(event, square)}
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
                  locale={locale}
                  reducedMotion={reducedMotion}
                  tacticalCelebrations={celebrateActiveEffect}
                  onComplete={() => finishBoardEffect(activeEffect.id)}
                />
              ) : null}
            </div>
            {game.status === "completed"
              && !viewingHistory
              && !activeEffect
              && !finisher
              && !surrendering
              && !postGameDismissed ? (
                <PostGamePanel
                  game={game}
                  onDismiss={() => {
                    setPostGameDismissed(true);
                    focusBoardSquare(focusedSquare);
                  }}
                  onReview={() => {
                    setHistoryPly(Math.max(0, game.plyCount - 1));
                    sidePanelTrigger.current = null;
                    setSidePanel("history");
                  }}
                />
              ) : null}
          </div>
          {message ? <p className="board-message" role="status">{t(message)}</p> : null}
        </div>

        <nav
          className="mobile-game-tools"
          dir="ltr"
          aria-label={t("Game details")}
          aria-hidden={mobileToolsActive && sidePanel ? true : undefined}
          inert={mobileToolsActive && sidePanel ? true : undefined}
        >
          {game.status === "waiting" ? (
            <button
              type="button"
              aria-controls="game-detail-panel"
              aria-expanded={sidePanel === "invite"}
              onClick={(event) => openSidePanel("invite", event.currentTarget)}
            >
              <span aria-hidden="true">⌁</span>{game.players.black ? t("Challenge") : t("Invite")}
            </button>
          ) : null}
          <button
            type="button"
            aria-controls="game-detail-panel"
            aria-expanded={sidePanel === "captures"}
            onClick={(event) => openSidePanel("captures", event.currentTarget)}
          ><span aria-hidden="true">♟</span>{t("Pieces")}</button>
          <button
            type="button"
            aria-controls="game-detail-panel"
            aria-expanded={sidePanel === "history"}
            onClick={(event) => openSidePanel("history", event.currentTarget)}
          ><span aria-hidden="true">↶</span>{t("Moves")}</button>
          <button
            type="button"
            aria-controls="game-detail-panel"
            aria-expanded={sidePanel === "info"}
            onClick={(event) => openSidePanel("info", event.currentTarget)}
          ><span aria-hidden="true">{game.magicRules ? "✦" : "i"}</span>{game.magicRules ? t("World") : t("Info")}</button>
        </nav>
        <button
          className="game-sidebar-backdrop"
          type="button"
          data-open={sidePanel && mobileToolsActive ? "true" : "false"}
          aria-label={t("Close game details")}
          tabIndex={-1}
          onClick={closeSidePanel}
        />
        <aside
          id="game-detail-panel"
          className="game-sidebar"
          dir={dir}
          data-open={sidePanel ? "true" : "false"}
          role={mobileToolsActive && sidePanel ? "dialog" : undefined}
          aria-modal={mobileToolsActive && sidePanel ? true : undefined}
          aria-label={mobileToolsActive && sidePanel
            ? game.magicRules && sidePanel === "info" ? t("World details") : t("${p0} details", {p0: t(SIDE_PANEL_LABELS[sidePanel])})
            : undefined}
          onKeyDown={trapSidePanelFocus}
        >
          <button ref={sidePanelClose} className="side-panel-close" type="button" onClick={closeSidePanel} aria-label={t("Close game details")}>×</button>
          {game.status === "waiting" ? (
            <div className="sidebar-panel" data-panel="invite" data-active={sidePanel === "invite"}><section className="side-card invite-card">
              <span className="side-icon">⌁</span><h2>{game.players.black ? game.you.color === "w" ? t("Challenge sent") : t("Challenge received") : t("Share invite")}</h2>
              <p>{game.players.black
                ? game.you.color === "w"
                  ? <>{t("Waiting for")}{" "}<bdi dir="auto">@{game.players.black.name}</bdi>{" "}{t("to accept.")}</>
                  : <><bdi dir="auto">@{game.players.white.name}</bdi>{" "}{t("challenged you.")}{" "}{game.plyCount > 0 ? t("White has played the opening. Your turn starts when you accept.") : t("Accept as Black. White moves first.")}</>
                : t("Share the private link. Your friend can accept as Black whenever they are ready.")}</p>
              {game.players.black && game.you.color === "b"
                ? <div className="waiting-challenge-actions">
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void answerWaitingChallenge("accept")}>{busy ? t("Accepting…") : t("Accept as Black")}</button>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => void answerWaitingChallenge("decline")}>{t("Decline")}</button>
                </div>
                : inviteUrl ? <><button className="primary-button" onClick={() => void copyInvite()}>{inviteShared ? t("Copied ✓") : t("Copy invite link")}</button>
                <input className="invite-field" dir="ltr" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} aria-label={t("Invite link")} /></> :
                game.players.black ? null : <p className="form-error">{t("The invite link is no longer saved on this device.")}</p>}
            </section></div>
          ) : null}
          <div className="sidebar-panel" data-panel="captures" data-active={sidePanel === "captures"}><CapturedPiecesPanel
              whiteCaptured={lostPieces.w}
              blackCaptured={lostPieces.b}
            /></div>
          <div className="sidebar-panel" data-panel="history" data-active={sidePanel === "history"}><MoveHistoryPanel
              moves={game.moves}
              currentPly={visibleHistoryPly}
              locale={locale}
            /></div>
          <div className="sidebar-panel" data-panel="info" data-active={sidePanel === "info"}>
            {game.magicRules ? (
              <section className="side-card world-game-card" role="note">
                <span aria-hidden="true">✦</span>
                <div>
                  <strong>{game.world ? <>{t("World")}{" "}<bdi dir="ltr">{game.world.displayCode}</bdi></> : t("Legacy magic rules")}</strong>
                  <small>{game.magicRules.rules.map((rule) => magicRuleLabel(rule, locale)).join(" • ")}</small>
                  {game.world ? (
                    <p>
                      {game.world.creatorUsername
                        ? <>{t("Created by")}{" "}<bdi dir="auto">@{game.world.creatorUsername}</bdi></>
                        : t("Created by a former player")}
                      <Link href={`/worlds/${game.world.code}`}>{t("View world")}</Link>
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
            <section className="side-card rules-card"><span aria-hidden="true">i</span><div><strong>{t("Game details")}</strong><small>
              {game.magicRules
                ? t("Magic chess • ")
                : t("${p0} • ${p1} • ", {p0: t(VARIANT_LABELS[variant.id].name), p1: game.variantId === "standard" ? "Standard setup" : "Mini-game"})}
              {game.mode === "solo" && game.aiDifficulty
                ? t("Riot Bot level ${p0} • ${p1}", {p0: game.aiDifficulty, p1: t(DIFFICULTY_LABELS[game.aiDifficulty])})
                : t("${p0} • Drag or tap • Every move is saved", {p0: game.turnPaceDays
                  ? `${game.turnPaceDays} ${game.turnPaceDays === 1 ? "day" : "days"} per move`
                  : "No turn time limit"})}
            </small></div></section>
            <div className="mobile-only-game-info">
              {game.claimableDraws.length > 0 ? (
                <div className="draw-claims" role="group" aria-label={t("Available draw claims")}>
                  <span>{t("You can claim a draw")}</span>
                  {game.claimableDraws.map((claim) => (
                    <button
                      type="button"
                      key={claim}
                      disabled={busy || viewingHistory}
                      onClick={() => void claimDraw(claim)}
                    >
                      {claim === "threefold_repetition"
                        ? t("Claim draw: threefold repetition")
                        : t("Claim draw: 50-move rule")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
      </TestGameDetails>

      {drag?.moved && draggedPiece ? (
        <span
          className={`drag-ghost piece-${draggedPiece.color}`}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <ChessPiece type={draggedPiece.type} color={draggedPiece.color} />
        </span>
      ) : null}

      <dialog
        className="modal-backdrop"
        ref={promotionDialog}
        aria-label={t("Choose a piece for pawn promotion")}
        onCancel={(event) => {
          event.preventDefault();
          setPromotionMove(null);
        }}
        onClose={() => setPromotionMove(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setPromotionMove(null);
        }}
      >
        {promotionMove ? (
          <div className="promotion-card"><p>{t("Promote your pawn")}</p><div dir="ltr">
            {(["q", "r", "b", "n"] as Promotion[]).map((piece) => (
              <button
                key={piece}
                aria-label={t("Promote to ${p0}", {p0: t(CHESS_PIECE_NAMES[piece])})}
                autoFocus={piece === "q"}
                onClick={() => {
                  if (promotionMove.premove) {
                    setPremoveDraft({ from: promotionMove.from, to: promotionMove.to, promotion: piece });
                    setPromotionMove(null);
                  } else if (promotionMove.continuation) {
                    advanceMagicDraft(promotionMove.from, promotionMove.to, piece);
                  } else {
                    stageFirstMove(promotionMove.from, promotionMove.to, piece);
                  }
                }}
              >
                <ChessPiece type={piece} color={game.you.color} />
              </button>
            ))}
          </div><button className="cancel-promotion" onClick={() => setPromotionMove(null)}>{t("Cancel")}</button></div>
        ) : null}
      </dialog>

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
          <small>{coachWarning ? t("Chess coach") : t("Confirm move")}</small>
          <h2 id="move-confirm-title">{t("Are you sure?")}</h2>
          <p id="move-confirm-description">
            {pendingMoveDescription
              ? pendingMoveDescription.map((part, index) => part.dir === "ltr"
                ? <bdi dir="ltr" key={`${index}:${part.text}`}>{part.text}</bdi>
                : <span key={`${index}:${part.text}`}>{part.text}</span>)
              : t("Confirm this move?")}
          </p>
          {coachWarning ? (
            <div className="coach-warning">
              <button
                type="button"
                aria-expanded={coachExplanationOpen}
                aria-controls="coach-risk-explanation"
                onClick={() => setCoachExplanationOpen((current) => !current)}
              >
                {coachExplanationOpen ? t("Hide explanation") : t("Why is this risky?")}
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
            >{t("Keep thinking")}{" "}</button>
            <button
              className="primary-button"
              type="button"
              disabled={!pendingMove || busy}
              onClick={() => {
                if (pendingMove) void commitMove(pendingMove);
              }}
            >{t("Confirm move")}{" "}</button>
          </div>
        </div>
      </dialog>
    </main>
  );
}
