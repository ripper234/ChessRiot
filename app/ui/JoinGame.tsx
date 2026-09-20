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
  magicRules?: PublicMagicRules | null;
  world?: { code: string; displayCode: string; creatorUsername: string | null } | null;
}

interface JoinPayload {
  game?: GameSnapshot;
  error?: { code?: string };
}

const JOIN_RECOVERY_TIMEOUT_MS = 4_000;

const HEBREW_VARIANTS: Record<GameVariantId, {
  name: string;
  description: string;
}> = {
  standard: {
    name: "שחמט קלאסי",
    description: "לוח מלא. מט מנצח.",
  },
  "pawn-riot": {
    name: "מהומת רגלים",
    description: "מקדמים רגלי, בונים צבא ונותנים מט.",
  },
  "half-army": {
    name: "חצי צבא",
    description: "מלך, צריח, רץ, פרש וארבעה רגלים.",
  },
  "pawn-duel": {
    name: "דו-קרב רגלים",
    description: "מרוץ טקטי קצר לקידום רגלי ולמט.",
  },
  "mate-pawn": {
    name: "הכתרת רגלי",
    description: "משתמשים באופוזיציה, מכתירים ונותנים מט.",
  },
  "mate-rook": {
    name: "מט עם צריח",
    description: "מצמצמים את המרחב ודוחקים את המלך לקצה.",
  },
  "mate-two-bishops": {
    name: "מט עם שני רצים",
    description: "מתאמים בין שני הרצים והמלך כדי לכפות מט.",
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
      setError("לא הצלחנו להשלים את ההצטרפות. ייתכן שהיא כבר בוצעה, ולכן אפשר לנסות שוב בבטחה.");
    } finally {
      if (joinRequest.current === controller) {
        joinRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <main className="join-shell" lang="he" dir="rtl" translate="no">
      <header className="topbar"><Brand locale="he" /></header>
      <section className="join-stage">
        <div className="challenge-mark" aria-hidden="true"><span>♜</span><b>נגד</b><span>♞</span></div>
        {invite.kind === "loading" ? <div className="voxel-card state-card">
          <h1>פותח את ההזמנה…</h1>
          <p role="status">בודק את המשחק ואת החשבון שלכם.</p>
          <button className="primary-button" type="button" onClick={() => void loadInvite()}>ניסיון נוסף</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </div> : null}
        {invite.kind === "waiting" ? (
          <form className="voxel-card join-card" onSubmit={join} noValidate>
            <p className="eyebrow"><span /> הזמנה פרטית למשחק</p>
            <h1><em><bdi dir="auto">{invite.creatorName}</bdi></em><br />רוצה לשחק מולך.</h1>
            <div className="variant-invite">
              <strong>{invite.variantId === "standard" ? "♜ שחמט" : "⚔ משחק קצר"}</strong>
              <span>{HEBREW_VARIANTS[invite.variantId].name}</span>
              <small>{HEBREW_VARIANTS[invite.variantId].description}</small>
            </div>
            <p className="join-pace">
              <strong>⌛ {invite.turnPaceDays
                ? invite.turnPaceDays === 1
                  ? "יום אחד לכל מהלך"
                  : `${invite.turnPaceDays} ימים לכל מהלך`
                : "ללא מגבלת זמן למהלך"}</strong>
            </p>
            {invite.magicRules ? (
              <div className="magic-invite">
                <strong>✦ חוקי קסם</strong>
                <span>{invite.magicRules.rules.map((rule) => magicRuleLabel(rule, "he")).join(" · ")}</span>
                {invite.world ? <small>
                  עולם <bdi dir="ltr">{invite.world.displayCode}</bdi>
                  {invite.world.creatorUsername ? <> · <PlayerHandle username={invite.world.creatorUsername} /></> : null}
                </small> : null}
              </div>
            ) : null}
            <p className="join-identity">הצטרפות בתור <strong><PlayerHandle username={account.username} /></strong></p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "מצטרף…" : "אישור והצטרפות כשחור ←"}
            </button>
            <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
            <p className="fine-print">האישור מתחיל את המשחק ומוסיף אותו לחשבון שלכם.</p>
          </form>
        ) : null}
        {invite.kind === "claimed" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">⚑</span><h1>המקום כבר נתפס</h1>
            <p>ההזמנה הזו כבר שימשה שחקן אחר.</p>
            <button className="primary-button" type="button" onClick={() => void loadInvite()}>בדיקה נוספת</button>
            <Link className="secondary-button" href="/app">פתיחת משחק אחר</Link>
            <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
          </div>
        ) : null}
        {invite.kind === "cancelled" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">×</span><h1>המשחק בוטל</h1>
            <p>יוצר המשחק ביטל אותו לפני שהתחיל.</p><Link className="secondary-button" href="/app">פתיחת משחק אחר</Link>
            <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
          </div>
        ) : null}
        {invite.kind === "missing" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">?</span><h1>ההזמנה לא נמצאה</h1>
            <p>בקשו מיוצר המשחק קישור חדש.</p><Link className="secondary-button" href="/app">מעבר למשחקים</Link>
            <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
          </div>
        ) : null}
        {invite.kind === "error" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">↻</span><h1>החיבור נקטע</h1>
            <p>המשחק עדיין לא נטען. בדקו את החיבור ונסו שוב.</p>
            <button className="primary-button" type="button" onClick={() => void loadInvite()}>ניסיון נוסף</button>
            <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
