"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiDifficulty,
  GameMode,
  GameSnapshot,
  TurnPaceDays,
} from "@/lib/game-types";
import { readApiJson } from "@/lib/client-http";
import {
  generateSecret,
  generateUuid,
  gamePathWithInvitation,
  inviteKey,
  playerKey,
  rememberGame,
} from "@/lib/client-storage";
import { gameCreatePayload, type PendingGameCreate } from "@/lib/game-creation";
import { DIFFICULTY_LABELS } from "@/lib/game-presentation";
import {
  gameVariant,
  isGameVariantId,
  type GameVariantId,
} from "@/lib/game-variants";
import {
  MAGIC_PROMPT_MAX_LENGTH,
  normalizeMagicPrompt,
} from "@/lib/magic-rules";
import { canonicalUsername, validateUsername } from "@/lib/usernames";
import { isAiDifficulty, isTurnPaceDays } from "@/lib/validation";
import { useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";
import { GameVariantPicker } from "./GameVariantPicker";
import { PlayerHandle } from "./PlayerHandle";

interface FriendsPayload {
  friends?: Array<{ username?: unknown }>;
}

interface AppliedWorld {
  code: string;
  displayCode: string;
  labels: string[];
  creatorUsername: string | null;
  gamesPlayed: number;
}

interface StoredMagicReservation {
  version: 1;
  pending: PendingGameCreate;
  world: AppliedWorld;
  mode: GameMode;
  difficulty: AiDifficulty;
  turnPaceDays: TurnPaceDays;
  opponentUsername: string;
  creditBalance: number | null;
}

interface StoredMagicApplyDraft {
  version: 1;
  pending: PendingGameCreate;
  prompt: string;
  selectedWorldCode: string | null;
  parentWorldCode: string | null;
  mode: GameMode;
  difficulty: AiDifficulty;
  turnPaceDays: TurnPaceDays;
  opponentUsername: string;
}

class MagicApplyRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MagicApplyRequestError";
  }
}

const SETTLED_MAGIC_ERROR_CODES = new Set([
  "invalid",
  "invalid_prompt",
  "unsupported",
  "ambiguous",
  "compiler_unconfigured",
  "compiler_circuit_open",
  "compiler_storage_error",
  "provider_timeout",
  "provider_network_error",
  "provider_auth_error",
  "provider_rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "invalid_provider_response",
  "compile_budget_reached",
  "rate_limited",
  "insufficient_credits",
  "idempotency_conflict",
  "lineage_conflict",
  "not_found",
]);

function reservationStorageKey(username: string): string {
  return `chessriot:magic-reservation:v1:${canonicalUsername(username)}`;
}

function applyDraftStorageKey(username: string): string {
  return `chessriot:magic-apply-draft:v1:${canonicalUsername(username)}`;
}

function removeMagicApplyDraft(username: string): void {
  try {
    localStorage.removeItem(applyDraftStorageKey(username));
  } catch {
    // A stale local draft can only replay the same idempotent server request.
  }
}

function isStoredPending(value: unknown): value is PendingGameCreate {
  const pending = value as Partial<PendingGameCreate> | null;
  return Boolean(
    pending
    && typeof pending.playerToken === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(pending.playerToken)
    && typeof pending.inviteToken === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(pending.inviteToken)
    && typeof pending.requestId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.requestId)
  );
}

export function isStoredOpponentUsername(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string") return false;
  const validation = validateUsername(value);
  return validation.ok && validation.username === value;
}

function parseStoredMagicReservation(value: string | null): StoredMagicReservation | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as Partial<StoredMagicReservation>;
    const world = stored.world as Partial<AppliedWorld> | undefined;
    if (
      stored.version !== 1
      || (stored.mode !== "solo" && stored.mode !== "multiplayer")
      || !isAiDifficulty(stored.difficulty)
      || !isTurnPaceDays(stored.turnPaceDays)
      || !isStoredOpponentUsername(stored.opponentUsername)
      || (stored.creditBalance !== null && typeof stored.creditBalance !== "number")
      || !isStoredPending(stored.pending)
      || typeof world?.code !== "string"
      || !/^0x[0-9a-f]{40}$/.test(world.code)
      || typeof world.displayCode !== "string"
      || !Array.isArray(world.labels)
      || !world.labels.every((label) => typeof label === "string")
      || (world.creatorUsername !== null && typeof world.creatorUsername !== "string")
      || typeof world.gamesPlayed !== "number"
    ) return null;
    return stored as StoredMagicReservation;
  } catch {
    return null;
  }
}

function parseStoredMagicApplyDraft(value: string | null): StoredMagicApplyDraft | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as Partial<StoredMagicApplyDraft>;
    if (
      stored.version !== 1
      || !isStoredPending(stored.pending)
      || typeof stored.prompt !== "string"
      || stored.prompt.length > MAGIC_PROMPT_MAX_LENGTH
      || (stored.selectedWorldCode !== null
        && (typeof stored.selectedWorldCode !== "string"
          || !/^0x[0-9a-f]{40}$/.test(stored.selectedWorldCode)))
      || (stored.parentWorldCode !== null
        && (typeof stored.parentWorldCode !== "string"
          || !/^0x[0-9a-f]{40}$/.test(stored.parentWorldCode)))
      || (stored.mode !== "solo" && stored.mode !== "multiplayer")
      || !isAiDifficulty(stored.difficulty)
      || !isTurnPaceDays(stored.turnPaceDays)
      || !isStoredOpponentUsername(stored.opponentUsername)
    ) return null;
    return stored as StoredMagicApplyDraft;
  } catch {
    return null;
  }
}

export function CreateGame() {
  const router = useRouter();
  const account = useAccountSession();
  const [mode, setMode] = useState<GameMode>("solo");
  const [variantId, setVariantId] = useState<GameVariantId>("standard");
  const [difficulty, setDifficulty] = useState<AiDifficulty>(3);
  const [turnPaceDays, setTurnPaceDays] = useState<TurnPaceDays>(3);
  const [friends, setFriends] = useState<string[]>([]);
  const [opponentUsername, setOpponentUsername] = useState("");
  const [magicOn, setMagicOn] = useState(false);
  const [magicPrompt, setMagicPrompt] = useState("");
  const [selectedWorldCode, setSelectedWorldCode] = useState<string | null>(null);
  const [parentWorldCode, setParentWorldCode] = useState<string | null>(null);
  const [appliedWorld, setAppliedWorld] = useState<AppliedWorld | null>(null);
  const [magicReservationLoading, setMagicReservationLoading] = useState(
    account.features.magicRules,
  );
  const [magicApplyBusy, setMagicApplyBusy] = useState(false);
  const [magicApplyRetryPending, setMagicApplyRetryPending] = useState(false);
  const [magicApplyMessage, setMagicApplyMessage] = useState("");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [magicRequestStatus, setMagicRequestStatus] = useState<"none" | "pending">(
    account.featureRequests.magicRules === "pending" ? "pending" : "none",
  );
  const [magicRequestBusy, setMagicRequestBusy] = useState(false);
  const [magicRequestMessage, setMagicRequestMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<PendingGameCreate | null>(null);
  const selectedVariant = gameVariant(variantId);
  const magicResult = useMemo(
    () => magicOn && magicPrompt.trim() ? normalizeMagicPrompt(magicPrompt) : null,
    [magicOn, magicPrompt],
  );

  useEffect(() => {
    let cancelled = false;
    const search = new URL(window.location.href).searchParams;
    const reservationKey = reservationStorageKey(account.username);
    let storedReservation: string | null = null;
    let storedApplyDraft: string | null = null;
    try {
      storedReservation = localStorage.getItem(reservationKey);
      storedApplyDraft = localStorage.getItem(applyDraftStorageKey(account.username));
    } catch {
      // Setup and query-string restoration still work when browser storage is blocked.
    }
    const restored = parseStoredMagicReservation(storedReservation);
    const restoredDraft = restored
      ? null
      : parseStoredMagicApplyDraft(storedApplyDraft);
    const restoredMagicSetup = Boolean(restored || restoredDraft);
    const requestedVariant = search.get("variant");
    const requestedMode = search.get("mode");
    const requestedDifficulty = Number(search.get("difficulty"));
    const requestedPace = Number(search.get("pace"));
    const requestedOpponent = search.get("opponent");
    const requestedMagic = search.get("magic") ?? search.get("magicPrompt");
    const requestedWorld = search.get("world");
    const requestedFork = search.get("fork");
    const validVariant = requestedVariant && isGameVariantId(requestedVariant)
      ? requestedVariant
      : "standard";
    if (restored && account.features.magicRules) {
      pending.current = restored.pending;
      setMode(restored.mode);
      setVariantId("standard");
      setDifficulty(restored.difficulty);
      setTurnPaceDays(restored.turnPaceDays);
      setOpponentUsername(restored.opponentUsername);
      setMagicOn(true);
      setSelectedWorldCode(restored.world.code);
      setParentWorldCode(null);
      setAppliedWorld(restored.world);
      setCreditBalance(restored.creditBalance);
      setMagicApplyMessage("Reserved Magic game restored. Start it to use the paid credit.");
    } else if (restoredDraft && account.features.magicRules) {
      pending.current = restoredDraft.pending;
      setMode(restoredDraft.mode);
      setVariantId("standard");
      setDifficulty(restoredDraft.difficulty);
      setTurnPaceDays(restoredDraft.turnPaceDays);
      setOpponentUsername(restoredDraft.opponentUsername);
      setMagicOn(true);
      setMagicPrompt(restoredDraft.prompt);
      setSelectedWorldCode(restoredDraft.selectedWorldCode);
      setParentWorldCode(restoredDraft.parentWorldCode);
      setMagicApplyRetryPending(true);
      setMagicApplyMessage("Unfinished Apply restored. Retry it to recover the same paid request.");
    } else if (requestedVariant && isGameVariantId(requestedVariant)) {
      setVariantId(requestedVariant);
      if (gameVariant(requestedVariant).soloOnly) setMode("solo");
      else if (requestedMode === "multiplayer") setMode("multiplayer");
      else if (requestedMode === "solo") setMode("solo");
    } else if (requestedMode === "multiplayer" || requestedMode === "solo") {
      setMode(requestedMode);
    } else if (requestedOpponent) {
      setMode("multiplayer");
    }
    if (!restoredMagicSetup && isAiDifficulty(requestedDifficulty)) setDifficulty(requestedDifficulty);
    if (!restoredMagicSetup && isTurnPaceDays(requestedPace)) setTurnPaceDays(requestedPace);
    if (
      !restoredMagicSetup
      &&
      account.features.magicRules
      && validVariant === "standard"
      && requestedMagic
    ) {
      const normalized = normalizeMagicPrompt(requestedMagic);
      if (normalized.ok) {
        setMagicPrompt(normalized.prompt);
        setMagicOn(true);
      }
    }
    if (!restoredMagicSetup && account.features.magicRules && validVariant === "standard" && requestedWorld) {
      setMagicOn(true);
      setSelectedWorldCode(requestedWorld);
      setMagicApplyMessage("Existing World selected. Apply Magic to reserve this game for 1 credit.");
    } else if (!restoredMagicSetup && account.features.magicRules && validVariant === "standard" && requestedFork) {
      setMagicOn(true);
      setMagicApplyMessage("Loading the parent World rules…");
      void fetch(`/api/worlds/${encodeURIComponent(requestedFork)}`, {
        cache: "no-store",
        credentials: "same-origin",
      }).then(async (response) => {
        const payload = await response.json() as {
          world?: { code?: unknown; labels?: unknown };
          error?: { message?: unknown };
        };
        if (
          !response.ok
          || typeof payload.world?.code !== "string"
          || !Array.isArray(payload.world.labels)
          || !payload.world.labels.every((label) => typeof label === "string")
        ) {
          throw new Error(typeof payload.error?.message === "string"
            ? payload.error.message
            : "The parent World could not be loaded.");
        }
        if (cancelled) return;
        setParentWorldCode(payload.world.code);
        setMagicPrompt(`${payload.world.labels.join(". ")}.`);
        setMagicApplyMessage("Parent rules loaded. Edit the complete rules, then Apply Magic to fork.");
      }).catch((caught) => {
        if (!cancelled) setMagicApplyMessage(caught instanceof Error
          ? caught.message
          : "The parent World could not be loaded.");
      });
    }
    const explicitMagicSetup = Boolean(requestedMagic || requestedWorld || requestedFork);
    if (
      account.features.magicRules
      && !restoredMagicSetup
      && !explicitMagicSetup
      && validVariant === "standard"
    ) {
      void fetch("/api/worlds/apply", { cache: "no-store", credentials: "same-origin" })
        .then(async (response) => response.ok
          ? await response.json() as {
            reservation?: {
              gameCreateRequestId?: unknown;
              world?: AppliedWorld;
              creditBalance?: unknown;
            } | null;
          }
          : null)
        .then((payload) => {
          if (cancelled || !payload?.reservation?.world) return;
          const requestId = payload.reservation.gameCreateRequestId;
          if (typeof requestId !== "string") return;
          pending.current = {
            playerToken: generateSecret(),
            inviteToken: generateSecret(),
            requestId,
          };
          setMode("solo");
          setOpponentUsername("");
          setVariantId("standard");
          setMagicOn(true);
          setSelectedWorldCode(payload.reservation.world.code);
          setParentWorldCode(null);
          setAppliedWorld(payload.reservation.world);
          if (typeof payload.reservation.creditBalance === "number") {
            setCreditBalance(payload.reservation.creditBalance);
          }
          setMagicApplyMessage("Paid Magic reservation recovered. Start it to use the reserved game.");
        })
        .catch(() => {
          // Setup remains usable when reservation recovery is temporarily unavailable.
        })
        .finally(() => {
          if (!cancelled) setMagicReservationLoading(false);
        });
    } else {
      setMagicReservationLoading(false);
    }
    void fetch("/api/me/friends", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? await response.json() as FriendsPayload : null)
      .then((payload) => {
        if (cancelled || !payload) return;
        const usernames = (payload.friends ?? []).flatMap((friend) =>
          typeof friend.username === "string" ? [friend.username] : []);
        setFriends(usernames);
        if (
          !restoredMagicSetup
          && !pending.current
          && requestedOpponent
          && usernames.some((username) => canonicalUsername(username) === canonicalUsername(requestedOpponent))
        ) {
          setOpponentUsername(usernames.find((username) => canonicalUsername(username) === canonicalUsername(requestedOpponent)) ?? "");
        }
      })
      .catch(() => {
        // A temporary friends-list failure never blocks Solo or link invitations.
      });
    void fetch("/api/me/referral", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok
        ? await response.json() as { credits?: unknown }
        : null)
      .then((payload) => {
        if (!cancelled && typeof payload?.credits === "number") setCreditBalance(payload.credits);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [account.features.magicRules, account.username]);

  useEffect(() => {
    if (!account.features.magicRules || !appliedWorld || !pending.current) return;
    const reservation: StoredMagicReservation = {
      version: 1,
      pending: pending.current,
      world: appliedWorld,
      mode,
      difficulty,
      turnPaceDays,
      opponentUsername,
      creditBalance,
    };
    try {
      localStorage.setItem(
        reservationStorageKey(account.username),
        JSON.stringify(reservation),
      );
    } catch {
      // The server entitlement remains authoritative when storage is unavailable.
    }
  }, [
    account.features.magicRules,
    account.username,
    appliedWorld,
    creditBalance,
    difficulty,
    mode,
    opponentUsername,
    turnPaceDays,
  ]);

  function resetPending() {
    if (!appliedWorld && !magicApplyRetryPending) pending.current = null;
    setError("");
  }

  async function applyMagic() {
    if (!selectedWorldCode && (!magicResult || !magicResult.ok)) {
      setMagicApplyMessage(magicResult && !magicResult.ok
        ? magicResult.message
        : "Describe the Magic Rule.");
      return;
    }
    setMagicApplyBusy(true);
    setError("");
    setMagicApplyMessage("");
    pending.current ??= {
      playerToken: generateSecret(),
      inviteToken: generateSecret(),
      requestId: generateUuid(),
    };
    const applyPending = pending.current;
    const draft: StoredMagicApplyDraft = {
      version: 1,
      pending: applyPending,
      prompt: selectedWorldCode
        ? ""
        : magicResult && magicResult.ok ? magicResult.prompt : magicPrompt,
      selectedWorldCode,
      parentWorldCode,
      mode,
      difficulty,
      turnPaceDays,
      opponentUsername,
    };
    try {
      localStorage.setItem(
        applyDraftStorageKey(account.username),
        JSON.stringify(draft),
      );
    } catch {
      pending.current = null;
      setMagicApplyBusy(false);
      setMagicApplyMessage("Magic could not safely preserve this paid request in your browser. Check storage access and try again.");
      return;
    }
    setMagicApplyRetryPending(true);
    try {
      const response = await fetch("/api/worlds/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: applyPending.requestId,
          ...(selectedWorldCode
            ? { worldCode: selectedWorldCode }
            : { prompt: magicResult && magicResult.ok ? magicResult.prompt : magicPrompt }),
          ...(parentWorldCode ? { parentCode: parentWorldCode } : {}),
        }),
      });
      const payload = await readApiJson(response) as {
        world?: AppliedWorld;
        created?: unknown;
        creditBalance?: unknown;
        error?: { code?: unknown; message?: unknown };
      } | null;
      if (!response.ok || !payload?.world) {
        const errorCode = typeof payload?.error?.code === "string"
          ? payload.error.code
          : null;
        const requestMayStillBePending = errorCode === "in_progress"
          || (response.status >= 500 && !errorCode)
          || (response.status >= 500
            && errorCode !== null
            && !SETTLED_MAGIC_ERROR_CODES.has(errorCode));
        if (!requestMayStillBePending) {
          pending.current = null;
          setMagicApplyRetryPending(false);
          removeMagicApplyDraft(account.username);
        }
        throw new MagicApplyRequestError(typeof payload?.error?.message === "string"
          ? `${payload.error.message}${requestMayStillBePending ? " Your Apply request is saved—retry it safely." : ""}`
          : `ChessRiot returned an unexpected server response (HTTP ${response.status}). Your Apply request is saved—retrying it cannot double-charge you.`);
      }
      const nextCreditBalance = typeof payload.creditBalance === "number"
        ? payload.creditBalance
        : creditBalance;
      if (pending.current) {
        const reservation: StoredMagicReservation = {
          version: 1,
          pending: pending.current,
          world: payload.world,
          mode,
          difficulty,
          turnPaceDays,
          opponentUsername,
          creditBalance: nextCreditBalance,
        };
        try {
          localStorage.setItem(
            reservationStorageKey(account.username),
            JSON.stringify(reservation),
          );
        } catch {
          // The authenticated server recovery route retains the reservation.
        }
      }
      removeMagicApplyDraft(account.username);
      setMagicApplyRetryPending(false);
      setAppliedWorld(payload.world);
      setSelectedWorldCode(payload.world.code);
      if (typeof payload.creditBalance === "number") setCreditBalance(payload.creditBalance);
      setMagicApplyMessage(payload.created === true
        ? "World created. This Magic game is reserved."
        : "Existing World found. This Magic game is reserved.");
    } catch (caught) {
      setAppliedWorld(null);
      if (caught instanceof MagicApplyRequestError) {
        setMagicApplyMessage(caught.message);
      } else {
        setMagicApplyMessage("ChessRiot could not reach the server. This is a connection or site-access error, not an invalid rule. Your Apply request is saved; retrying it cannot double-charge you.");
      }
    } finally {
      setMagicApplyBusy(false);
    }
  }

  async function requestMagicAccess() {
    setMagicRequestBusy(true);
    setMagicRequestMessage("");
    try {
      const response = await fetch("/api/me/feature-access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feature: "magic_rules" }),
      });
      const payload = await response.json() as {
        status?: unknown;
        error?: { message?: unknown };
      };
      if (!response.ok || (payload.status !== "pending" && payload.status !== "enabled")) {
        throw new Error(typeof payload.error?.message === "string"
          ? payload.error.message
          : "Could not send the request.");
      }
      if (payload.status === "enabled") {
        window.location.reload();
        return;
      }
      setMagicRequestStatus("pending");
      setMagicRequestMessage("Request sent. Access will appear here after you are invited.");
    } catch (caught) {
      setMagicRequestMessage(caught instanceof Error
        ? caught.message
        : "Could not send the request.");
    } finally {
      setMagicRequestBusy(false);
    }
  }

  async function createGame(event: FormEvent) {
    event.preventDefault();
    if (magicOn && !appliedWorld) {
      setError("Apply Magic before starting the game.");
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
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gameCreatePayload({
          mode,
          variantId,
          difficulty,
          turnPaceDays,
          opponentUsername: opponentUsername || null,
          worldCode: magicOn ? appliedWorld?.code ?? null : null,
          pending: pending.current,
        })),
      });
      const data = await response.json() as {
        game?: GameSnapshot;
        inviteUrl?: string;
        error?: { message?: unknown };
      };
      const needsLink = mode === "multiplayer" && !opponentUsername;
      if (!response.ok || !data.game || (needsLink && !data.inviteUrl)) {
        throw new Error(typeof data.error?.message === "string"
          ? data.error.message
          : "Could not create the game");
      }
      try {
        localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
        if (magicOn) {
          localStorage.removeItem(reservationStorageKey(account.username));
        }
        if (data.inviteUrl) localStorage.setItem(inviteKey(data.game.id), data.inviteUrl);
        if (data.game.mode === "solo" && data.game.you.color === "b" && data.game.plyCount > 0) {
          sessionStorage.setItem(`chessriot:opening-intro:${data.game.id}`, "1");
        }
      } catch {
        // Account membership keeps the game available when local storage is unavailable.
      }
      if (magicOn) removeMagicApplyDraft(account.username);
      rememberGame(data.game);
      const challenge = opponentUsername
        ? `?challenge=sent&opponent=${encodeURIComponent(opponentUsername)}`
        : mode === "multiplayer" ? "?invitation=created" : "";
      router.push(data.inviteUrl
        ? gamePathWithInvitation(data.game.id, data.inviteUrl, "?invitation=created")
        : `/g/${data.game.id}${challenge}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-shell new-game-shell">
      <header className="topbar new-game-topbar">
        <Brand />
        <Link className="topbar-home-link" href="/">HOME</Link>
      </header>
      <section className="start-stage">
        <form className="voxel-card create-card" onSubmit={createGame} noValidate>
          <span className="card-kicker">NEW GAME · <PlayerHandle username={account.username} /></span>
          <h1>Start a new game</h1>
          <Link href="/notification-test" style={{ display: "block", fontSize: 16, marginBottom: 18 }}>בדיקת התראות במכשיר אחד · 4 תורים</Link>
          <GameVariantPicker
            value={variantId}
            disabled={busy || Boolean(appliedWorld) || magicApplyRetryPending}
            onChange={(nextVariantId) => {
              setVariantId(nextVariantId);
              if (gameVariant(nextVariantId).soloOnly) {
                setMode("solo");
                setOpponentUsername("");
              }
              if (nextVariantId !== "standard") setMagicOn(false);
              resetPending();
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
                    setOpponentUsername("");
                    resetPending();
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
                    resetPending();
                  }}
                />
                <span aria-hidden="true">⚔</span>
                <strong>CHALLENGE A FRIEND</strong>
                <small>{selectedVariant.soloOnly ? "Not available for training" : "Choose a friend or share a private invitation"}</small>
              </label>
            </div>
          </fieldset>

          {mode === "multiplayer" ? (
            <label className="opponent-picker" htmlFor="opponent-username">
              <span>WHO DO YOU WANT TO CHALLENGE?</span>
              <select
                id="opponent-username"
                value={opponentUsername}
                disabled={busy}
                onChange={(event) => {
                  setOpponentUsername(event.target.value);
                  resetPending();
                }}
              >
                <option value="">Create a private invitation link</option>
                {friends.map((username) => (
                  <option dir="auto" value={username} key={username}>@{username}</option>
                ))}
              </select>
              <small>{friends.length
                ? "Choose a friend to send a challenge, or create a private link. The game starts when they accept."
                : <>Add friends from <Link href="/">Home</Link>, or create a private link. The game starts when someone accepts.</>}</small>
            </label>
          ) : null}

          {variantId === "standard" ? (
            account.features.magicRules ? (
              <div className={`magic-box${magicOn ? " enabled" : ""}`}>
                <label className="magic-toggle">
                  <input
                    type="checkbox"
                    checked={magicOn}
                    disabled={busy || Boolean(appliedWorld) || magicApplyRetryPending}
                    onChange={(event) => {
                      setMagicOn(event.target.checked);
                      if (!event.target.checked) setMagicApplyMessage("");
                      resetPending();
                    }}
                  />
                  <span aria-hidden="true">✦</span>
                  <div><strong>MAGIC RULES</strong><small>Experimental rules enabled for your account</small></div>
                  <b>{magicOn ? "ON" : "OFF"}</b>
                </label>
                {magicOn ? <div className="magic-prompt">
                  <label htmlFor="magic-prompt">Describe the rule</label>
                  <textarea
                    id="magic-prompt"
                    value={magicPrompt}
                    placeholder="e.g. Knights move twice"
                    maxLength={MAGIC_PROMPT_MAX_LENGTH}
                    disabled={
                      busy
                      || magicApplyBusy
                      || magicApplyRetryPending
                      || Boolean(appliedWorld)
                      || Boolean(selectedWorldCode && !parentWorldCode)
                    }
                    onChange={(event) => {
                      setMagicPrompt(event.target.value);
                      setAppliedWorld(null);
                      setSelectedWorldCode(null);
                      setMagicApplyMessage("");
                      resetPending();
                    }}
                  />
                  {selectedWorldCode && !parentWorldCode && !appliedWorld ? (
                    <p className="magic-world-selection">Selected World {selectedWorldCode}</p>
                  ) : magicResult?.ok ? (
                    <div className="magic-understood"><span>✓</span><p>Ready for Magic to check this rule and create a World if supported.</p></div>
                  ) : magicResult ? <p className="magic-error">{magicResult.message}</p> : null}
                  <div className="magic-apply-row">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        busy
                        || magicReservationLoading
                        || magicApplyBusy
                        || Boolean(appliedWorld)
                        || (!selectedWorldCode && magicResult?.ok !== true)
                      }
                      onClick={() => void applyMagic()}
                    >
                      {magicReservationLoading
                        ? "RECOVERING…"
                        : magicApplyBusy
                          ? "APPLYING…"
                          : appliedWorld
                            ? "MAGIC APPLIED ✓"
                            : magicApplyRetryPending ? "RETRY APPLY" : "APPLY MAGIC"}
                    </button>
                    <small>1 credit = 1 Magic game{creditBalance === null ? "" : ` · ${creditBalance} left`}</small>
                  </div>
                  {appliedWorld ? (
                    <div className="applied-world" role="status">
                      <strong>{appliedWorld.displayCode}</strong>
                      <span>{appliedWorld.labels.join(" · ")}</span>
                      <Link href={`/worlds/${appliedWorld.code}`}>VIEW WORLD</Link>
                    </div>
                  ) : null}
                  {magicApplyMessage ? <p className={appliedWorld ? "form-success" : "magic-access-message"} role={appliedWorld ? "status" : "alert"}>{magicApplyMessage}</p> : null}
                  <Link className="magic-world-browser-link" href="/worlds">BROWSE WORLDS</Link>
                </div> : null}
              </div>
            ) : (
              <div className="magic-box coming-soon">
                <div className="magic-toggle"><span aria-hidden="true">✦</span><div><strong>MAGIC RULES</strong><small>Experimental chess chaos</small></div><b>{magicRequestStatus === "pending" ? "REQUESTED" : "EARLY ACCESS"}</b></div>
                <div className="magic-coming-soon">
                  <strong>{magicRequestStatus === "pending" ? "YOU’RE ON THE REQUEST LIST" : "WANT AN INVITATION?"}</strong>
                  <p>{magicRequestStatus === "pending"
                    ? "We’ll enable Magic Rules here if your account is admitted."
                    : "Ask for early access. The ChessRiot team admits testers individually."}</p>
                  {magicRequestStatus === "pending" ? null : (
                    <button
                      className="magic-access-request"
                      type="button"
                      disabled={magicRequestBusy}
                      onClick={() => void requestMagicAccess()}
                    >
                      {magicRequestBusy ? "SENDING…" : "REQUEST AN INVITE"}
                    </button>
                  )}
                  {magicRequestMessage ? <p className="magic-access-message" role="status">{magicRequestMessage}</p> : null}
                </div>
              </div>
            )
          ) : (
            <div className="variant-fixed-rules">
              <span aria-hidden="true">{selectedVariant.icon}</span>
              <div><strong>{selectedVariant.name.toUpperCase()}</strong><small>{selectedVariant.group === "mating-set"
                ? "Solo practice · You command White · Checkmate wins"
                : "Fixed starting setup · Normal chess moves · Checkmate wins"}</small></div>
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
                  resetPending();
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
                    <input type="radio" name="turn-pace" value={days} checked={turnPaceDays === days}
                      onChange={() => { setTurnPaceDays(days); resetPending(); }} />
                    <strong>{days}</strong><small>{days === 1 ? "DAY" : "DAYS"}</small>
                  </label>
                ))}
              </div>
              <p>No live chess clock is shown. Missing this turn deadline ends the game.</p>
            </fieldset>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "STARTING…" : mode === "solo"
              ? "PLAY RIOT BOT  →"
              : opponentUsername ? `SEND CHALLENGE TO @${opponentUsername}  →` : "CREATE & SHARE INVITATION  →"}
          </button>
        </form>
      </section>
    </main>
  );
}
