"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  generateSecret,
  rememberGame,
} from "@/lib/client-storage";
import { fetchJsonWithReadTimeout } from "@/lib/client-recovery";
import type { GameSnapshot, TurnPaceDays } from "@/lib/game-types";
import { isTurnPaceDays } from "@/lib/validation";
import {
  type GameVariantId,
} from "@/lib/game-variants";
import { magicRuleLabel, type PublicMagicRules } from "@/lib/magic-rules";
import { useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";
import { PlayerHandle } from "./PlayerHandle";

type InviteState =
  | { kind: "loading" }
  | {
    kind: "waiting";
    gameId: string;
    creatorName: string;
    variantId: GameVariantId;
    turnPaceDays: TurnPaceDays | null;
    openingPlayed: boolean;
    magicRules: PublicMagicRules | null;
    world: { code: string; displayCode: string; creatorUsername: string | null } | null;
  }
  | { kind: "claimed"; gameId?: string }
  | { kind: "cancelled"; gameId?: string }
  | { kind: "missing" }
  | { kind: "error" };

interface InvitePayload {
  state?: string;
  gameId?: string;
  creatorName?: string;
  variantId?: GameVariantId;
  turnPaceDays?: unknown;
  openingPlayed?: unknown;
  magicRules?: PublicMagicRules | null;
  world?: { code: string; displayCode: string; creatorUsername: string | null } | null;
}

interface JoinPayload {
  game?: GameSnapshot;
  error?: { code?: string };
}

const JOIN_RECOVERY_TIMEOUT_MS = 4_000;

const VARIANT_LABELS: Record<GameVariantId, {
  name: string;
  description: string;
}> = {
  standard: {
    name: "Classic chess",
    description: "A full board. Checkmate wins.",
  },
  "pawn-riot": {
    name: "Pawn Riot",
    description: "Promote a pawn, build an army, and deliver checkmate.",
  },
  "half-army": {
    name: "Half Army",
    description: "A king, rook, bishop, knight, and four pawns.",
  },
  "pawn-duel": {
    name: "Pawn Duel",
    description: "A quick tactical race to promotion and checkmate.",
  },
  "mate-pawn": {
    name: "Pawn Promotion",
    description: "Use opposition, promote, and deliver checkmate.",
  },
  "mate-rook": {
    name: "Rook Checkmate",
    description: "Cut off escape squares and drive the king to the edge.",
  },
  "mate-two-bishops": {
    name: "Two-Bishop Checkmate",
    description: "Coordinate your two bishops and king to force checkmate.",
  },
};

export function JoinGame({
  inviteToken,
}: {
  inviteToken: string;
}) {
  const router = useRouter();
  const account = useAccountSession();
  const [invite, setInvite] = useState<InviteState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const playerToken = useRef<string | null>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const loadAttempt = useRef(0);
  const joinRequest = useRef<AbortController | null>(null);
  const joinAttempt = useRef(0);

  const loadInvite = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    const attemptId = ++loadAttempt.current;
    setInvite({ kind: "loading" });
    setError("");
    try {
      const { response, data } = await fetchJsonWithReadTimeout<InvitePayload>(
        `/api/invitations/${inviteToken}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || loadAttempt.current !== attemptId) return;
      if (!data) throw new Error();
      if (response.status === 410 && data.state === "claimed" && data.gameId) {
        try {
          const owned = await fetchJsonWithReadTimeout<{ game?: GameSnapshot }>(
            `/api/games/${encodeURIComponent(data.gameId)}`,
            {
              cache: "no-store",
              credentials: "same-origin",
              signal: controller.signal,
            },
            JOIN_RECOVERY_TIMEOUT_MS,
          );
          if (controller.signal.aborted || loadAttempt.current !== attemptId) return;
          if (owned.response.ok && owned.data?.game?.id === data.gameId) {
            rememberGame(owned.data.game);
            router.replace(`/g/${encodeURIComponent(data.gameId)}`);
            return;
          }
        } catch {
          if (controller.signal.aborted || loadAttempt.current !== attemptId) return;
          // The claimed state below remains a safe fallback when recovery fails.
        }
      }
      if (response.ok && data.gameId && data.creatorName) {
        setInvite({
          kind: "waiting",
          gameId: data.gameId,
          creatorName: data.creatorName,
          variantId: data.variantId ?? "standard",
          turnPaceDays: isTurnPaceDays(data.turnPaceDays) ? data.turnPaceDays : null,
          openingPlayed: data.openingPlayed === true,
          magicRules: data.magicRules ?? null,
          world: data.world ?? null,
        });
      } else if (response.status === 410) {
        setInvite({
          kind: data.state === "cancelled" ? "cancelled" : "claimed",
          gameId: data.gameId,
        });
      } else if (response.status === 404) {
        setInvite({ kind: "missing" });
      } else {
        setInvite({ kind: "error" });
      }
    } catch {
      if (controller.signal.aborted || loadAttempt.current !== attemptId) return;
      setInvite({ kind: "error" });
    } finally {
      if (loadRequest.current === controller) loadRequest.current = null;
    }
  }, [inviteToken, router]);

  useEffect(() => {
    void loadInvite();
    return () => {
      loadAttempt.current += 1;
      loadRequest.current?.abort();
      loadRequest.current = null;
      joinAttempt.current += 1;
      joinRequest.current?.abort();
      joinRequest.current = null;
    };
  }, [loadInvite]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (invite.kind !== "waiting") return;
    joinRequest.current?.abort();
    const controller = new AbortController();
    joinRequest.current = controller;
    const attemptId = ++joinAttempt.current;
    setBusy(true);
    setError("");
    const token = playerToken.current ?? generateSecret();
    playerToken.current = token;

    const recoverJoinedGame = async (): Promise<boolean> => {
      try {
        const recovered = await fetchJsonWithReadTimeout<{ game?: GameSnapshot }>(
          `/api/games/${encodeURIComponent(invite.gameId)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
          JOIN_RECOVERY_TIMEOUT_MS,
        );
        if (controller.signal.aborted || joinAttempt.current !== attemptId) return false;
        if (!recovered.response.ok || !recovered.data?.game) return false;
        rememberGame(recovered.data.game);
        router.replace(`/g/${encodeURIComponent(recovered.data.game.id)}`);
        return true;
      } catch {
        return false;
      }
    };

    try {
      const { response, data } = await fetchJsonWithReadTimeout<JoinPayload>(
        `/api/invitations/${inviteToken}/join`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerToken: token }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || joinAttempt.current !== attemptId) return;
      if (!data) throw new Error();
      if (response.status === 409 && data.error?.code === "invite_claimed") {
        if (await recoverJoinedGame()) return;
        setInvite({ kind: "claimed", gameId: invite.gameId });
        return;
      }
      if (response.status === 410 && data.error?.code === "invite_cancelled") {
        setInvite({ kind: "cancelled", gameId: invite.gameId });
        return;
      }
      if (!response.ok || !data.game) throw new Error();
      rememberGame(data.game);
      router.replace(`/g/${encodeURIComponent(data.game.id)}`);
    } catch {
      if (controller.signal.aborted || joinAttempt.current !== attemptId) return;
      if (await recoverJoinedGame()) return;
      if (controller.signal.aborted || joinAttempt.current !== attemptId) return;
      setError("Joining could not be confirmed. You may already have joined, so it is safe to try again.");
    } finally {
      if (joinRequest.current === controller) {
        joinRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <main className="join-shell" lang="en" dir="ltr" translate="no">
      <header className="topbar"><Brand locale="en" /></header>
      <section className="join-stage">
        <div className="challenge-mark" aria-hidden="true"><span>♜</span><b>vs</b><span>♞</span></div>
        {invite.kind === "loading" ? <div className="voxel-card state-card">
          <h1>Opening invitation…</h1>
          <p role="status">Checking the game and your account.</p>
          <button className="primary-button" type="button" onClick={() => void loadInvite()}>Try again</button>
          <Link className="secondary-button" href="/">Back to home</Link>
        </div> : null}
        {invite.kind === "waiting" ? (
          <form className="voxel-card join-card" onSubmit={join} noValidate>
            <p className="eyebrow"><span /> Private game invitation</p>
            <h1><em><bdi dir="auto">{invite.creatorName}</bdi></em><br />wants to play you.</h1>
            <div className="variant-invite">
              <strong>{invite.variantId === "standard" ? "♜ Chess" : "⚔ Quick game"}</strong>
              <span>{VARIANT_LABELS[invite.variantId].name}</span>
              <small>{VARIANT_LABELS[invite.variantId].description}</small>
            </div>
            <p className="join-pace">
              <strong>⌛ {invite.turnPaceDays
                ? invite.turnPaceDays === 1
                  ? "1 day per move"
                  : `${invite.turnPaceDays} days per move`
                : "No move time limit"}</strong>
            </p>
            {invite.magicRules ? (
              <div className="magic-invite">
                <strong>✦ Magic rules</strong>
                <span>{invite.magicRules.rules.map((rule) => magicRuleLabel(rule, "en")).join(" · ")}</span>
                {invite.world ? <small>
                  World <bdi dir="ltr">{invite.world.displayCode}</bdi>
                  {invite.world.creatorUsername ? <> · <PlayerHandle username={invite.world.creatorUsername} /></> : null}
                </small> : null}
              </div>
            ) : null}
            <p>{invite.openingPlayed ? "White has played the opening. Your turn starts when you accept." : "White moves first. Your friend may play the opening before you accept."}</p>
            <p className="join-identity">Joining as <strong><PlayerHandle username={account.username} /></strong></p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Joining…" : "Accept as Black"}
            </button>
            <Link className="secondary-button" href="/">Back to home</Link>
            <p className="fine-print">Accepting starts the game and adds it to your account.</p>
          </form>
        ) : null}
        {invite.kind === "claimed" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">⚑</span><h1>This seat is taken</h1>
            <p>Another player has already used this invitation.</p>
            <button className="primary-button" type="button" onClick={() => void loadInvite()}>Check again</button>
            <Link className="secondary-button" href="/app">Start another game</Link>
            <Link className="secondary-button" href="/">Back to home</Link>
          </div>
        ) : null}
        {invite.kind === "cancelled" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">×</span><h1>Game cancelled</h1>
            <p>The host cancelled this game before it started.</p><Link className="secondary-button" href="/app">Start another game</Link>
            <Link className="secondary-button" href="/">Back to home</Link>
          </div>
        ) : null}
        {invite.kind === "missing" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">?</span><h1>Invitation not found</h1>
            <p>Ask the host for a new link.</p><Link className="secondary-button" href="/app">Go to games</Link>
            <Link className="secondary-button" href="/">Back to home</Link>
          </div>
        ) : null}
        {invite.kind === "error" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">↻</span><h1>Connection interrupted</h1>
            <p>The game has not loaded. Check your connection and try again.</p>
            <button className="primary-button" type="button" onClick={() => void loadInvite()}>Try again</button>
            <Link className="secondary-button" href="/">Back to home</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
