"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonWithReadTimeout } from "@/lib/client-recovery";
import { generateUuid } from "@/lib/client-storage";
import { gameVariant, normalizeGameVariantId } from "@/lib/game-variants";
import type { TurnPaceDays } from "@/lib/game-types";
import { isTurnPaceDays } from "@/lib/validation";
import { validateUsername } from "@/lib/usernames";
import { useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";
import { ACTIVITY_CHANGED_EVENT } from "./ActivityInbox";
import { PlayerSafetyDialog } from "./PlayerSafetyDialog";
import { PlayerHandle } from "./PlayerHandle";

interface SocialPayload {
  friends?: Array<{ username?: unknown }>;
  incoming?: Array<{ id?: unknown; username?: unknown }>;
  outgoing?: Array<{ id?: unknown; username?: unknown }>;
}

interface ReferralPayload {
  inviteUrl?: unknown;
  credits?: unknown;
  invitedPlayers?: unknown;
  creditsPerSignup?: unknown;
}

interface ReferralDetails {
  inviteUrl: string;
  credits: number;
  invitedPlayers: number;
  creditsPerSignup: number;
}

interface GameItem {
  id: string;
  mode: "solo" | "multiplayer";
  variantId: ReturnType<typeof normalizeGameVariantId>;
  status: "waiting" | "active" | "completed";
  color: "w" | "b";
  opponent: string | null;
  turn: "w" | "b";
  turnPaceDays: TurnPaceDays | null;
  isMagic: boolean;
  updatedAt: string;
  outcome: { winner: "w" | "b" | null; reason: string } | null;
}

function gameDetail(game: GameItem): string {
  if (game.status === "waiting") return game.color === "b" ? game.turn === "b"
    ? "White has played the opening · Your turn starts when you accept" : "Your invitation to accept · White moves first"
    : game.turn === "b" ? "Opening saved · Awaiting acceptance" : "Invite saved · Awaiting acceptance";
  if (game.status === "active") return game.turn === game.color ? "Your turn" : "Their turn";
  if (game.outcome?.reason === "cancelled") return "Cancelled";
  if (!game.outcome || game.outcome.winner === null) return "Draw";
  return game.outcome.winner === game.color ? "Won" : "Lost";
}

function socialItems(value: unknown): Array<{ id: string; username: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { id?: unknown; username?: unknown };
    return typeof candidate.id === "string" && typeof candidate.username === "string"
      ? [{ id: candidate.id, username: candidate.username }]
      : [];
  });
}

function friendNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === "object"
    && typeof (item as { username?: unknown }).username === "string"
    ? [(item as { username: string }).username]
    : []);
}

export function PlayerHome() {
  const account = useAccountSession();
  const [friends, setFriends] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<Array<{ id: string; username: string }>>([]);
  const [outgoing, setOutgoing] = useState<Array<{ id: string; username: string }>>([]);
  const [games, setGames] = useState<GameItem[]>([]);
  const [friendUsername, setFriendUsername] = useState("");
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendMessage, setFriendMessage] = useState("");
  const [friendError, setFriendError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [challengeBusy, setChallengeBusy] = useState<string | null>(null);
  const [challengeMessage, setChallengeMessage] = useState("");
  const [challengeError, setChallengeError] = useState(false);
  const [referral, setReferral] = useState<ReferralDetails | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState(false);
  const [safetyTarget, setSafetyTarget] = useState<{ username: string; canRemove: boolean } | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    setLoading(true);
    setLoadError("");
    try {
      const [socialRead, gamesRead, referralRead] = await Promise.all([
        fetchJsonWithReadTimeout<SocialPayload>("/api/me/friends", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetchJsonWithReadTimeout<{ games?: unknown }>("/api/me/games?view=watch&limit=8", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetchJsonWithReadTimeout<ReferralPayload>("/api/me/referral", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);
      if (generation !== refreshGeneration.current) return;
      const { response: socialResponse, data: socialPayload } = socialRead;
      const { response: gamesResponse, data: gamesPayload } = gamesRead;
      const { response: referralResponse, data: referralPayload } = referralRead;
      if (!socialResponse.ok && !gamesResponse.ok && !referralResponse.ok) throw new Error();
      if (socialResponse.ok && socialPayload) {
        if (generation !== refreshGeneration.current) return;
        setFriends(friendNames(socialPayload.friends));
        setIncoming(socialItems(socialPayload.incoming));
        setOutgoing(socialItems(socialPayload.outgoing));
      }
      if (gamesResponse.ok && gamesPayload) {
        const rows = Array.isArray(gamesPayload.games) ? gamesPayload.games : [];
        if (generation !== refreshGeneration.current) return;
        setGames(rows.flatMap((row): GameItem[] => {
          if (!row || typeof row !== "object") return [];
          const game = row as Record<string, unknown>;
          const outcome = game.outcome && typeof game.outcome === "object"
            ? game.outcome as { winner?: unknown; reason?: unknown }
            : null;
          if (
            typeof game.id !== "string"
            || (game.mode !== "solo" && game.mode !== "multiplayer")
            || (game.status !== "waiting" && game.status !== "active" && game.status !== "completed")
            || (game.color !== "w" && game.color !== "b")
            || (game.turn !== "w" && game.turn !== "b")
            || typeof game.updatedAt !== "string"
          ) return [];
          return [{
            id: game.id,
            mode: game.mode,
            variantId: normalizeGameVariantId(game.variantId),
            status: game.status,
            color: game.color,
            opponent: typeof game.opponent === "string" ? game.opponent : null,
            turn: game.turn,
            turnPaceDays: isTurnPaceDays(game.turnPaceDays) ? game.turnPaceDays : null,
            isMagic: game.isMagic === true,
            updatedAt: game.updatedAt,
            outcome: outcome && typeof outcome.reason === "string"
              && (outcome.winner === "w" || outcome.winner === "b" || outcome.winner === null)
              ? { winner: outcome.winner, reason: outcome.reason }
              : null,
          }];
        }));
      }
      if (referralResponse.ok && referralPayload) {
        if (
          typeof referralPayload.inviteUrl === "string"
          && typeof referralPayload.credits === "number"
          && typeof referralPayload.invitedPlayers === "number"
          && typeof referralPayload.creditsPerSignup === "number"
        ) {
          if (generation !== refreshGeneration.current) return;
          setReferral({
            inviteUrl: referralPayload.inviteUrl,
            credits: referralPayload.credits,
            invitedPlayers: referralPayload.invitedPlayers,
            creditsPerSignup: referralPayload.creditsPerSignup,
          });
        }
      }
      if (!socialResponse.ok || !gamesResponse.ok || !referralResponse.ok) {
        if (generation !== refreshGeneration.current) return;
        setLoadError("Some account details could not be refreshed.");
      }
    } catch {
      if (generation !== refreshGeneration.current) return;
      setLoadError("Your games and friends could not be refreshed yet.");
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let lastRefreshAt = 0;
    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt < 1_000) return;
      lastRefreshAt = now;
      void refresh();
    };
    const interval = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    const refreshAfterActivityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(ACTIVITY_CHANGED_EVENT, refreshAfterActivityChange);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      window.removeEventListener(ACTIVITY_CHANGED_EVENT, refreshAfterActivityChange);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  async function addFriend(event: FormEvent) {
    event.preventDefault();
    const validated = validateUsername(friendUsername);
    if (!validated.ok) {
      setFriendMessage(validated.message);
      setFriendError(true);
      return;
    }
    setFriendBusy(true);
    setFriendMessage("");
    setFriendError(false);
    try {
      const response = await fetch("/api/me/friend-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: validated.username }),
      });
      const payload = await response.json() as { state?: unknown; error?: { message?: unknown } };
      if (!response.ok) throw new Error(typeof payload.error?.message === "string"
        ? payload.error.message
        : "Friend request could not be sent.");
      setFriendUsername("");
      setFriendMessage(payload.state === "already_friends"
        ? "You are friends already."
        : "Friend request sent.");
      await refresh();
    } catch (error) {
      setFriendError(true);
      setFriendMessage(error instanceof Error ? error.message : "Friend request could not be sent.");
    } finally {
      setFriendBusy(false);
    }
  }

  async function answerRequest(id: string, action: "accept" | "decline") {
    setFriendBusy(true);
    setFriendMessage("");
    try {
      const response = await fetch(`/api/me/friend-requests/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error();
      setFriendMessage(action === "accept" ? "Friend added." : "Request declined.");
      setFriendError(false);
      await refresh();
    } catch {
      setFriendMessage("That request could not be updated.");
      setFriendError(true);
    } finally {
      setFriendBusy(false);
    }
  }

  async function cancelRequest(id: string, username: string) {
    setFriendBusy(true);
    setFriendMessage("");
    setFriendError(false);
    try {
      const response = await fetch(`/api/me/friend-requests/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      setFriendMessage(`Request to @${username} cancelled.`);
      await refresh();
    } catch {
      setFriendMessage("That request could not be cancelled.");
      setFriendError(true);
    } finally {
      setFriendBusy(false);
    }
  }

  async function answerChallenge(game: GameItem, action: "accept" | "decline") {
    setChallengeBusy(game.id);
    setChallengeMessage("");
    setChallengeError(false);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}/challenge`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, requestId: generateUuid() }),
      });
      const payload = await response.json() as { error?: { message?: unknown } };
      if (!response.ok) {
        throw new Error(typeof payload.error?.message === "string"
          ? payload.error.message
          : "That challenge could not be updated.");
      }
      if (action === "accept") {
        window.location.assign(`/g/${encodeURIComponent(game.id)}`);
        return;
      }
      setChallengeMessage("Challenge declined.");
      await refresh();
    } catch (error) {
      setChallengeError(true);
      setChallengeMessage(error instanceof Error
        ? error.message
        : "That challenge could not be updated.");
      await refresh();
    } finally {
      setChallengeBusy(null);
    }
  }

  async function shareInvite() {
    if (!referral) return;
    setShareMessage("");
    setShareError(false);
    const shareData = {
      title: "Join me on ChessRiot",
      text: `Create a player account and connect with @${account.username} on ChessRiot. This friend link does not join a private game.`,
      url: referral.inviteUrl,
    };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(shareData);
        setShareMessage("Friend link shared.");
        return;
      }
      await navigator.clipboard.writeText(referral.inviteUrl);
      setShareMessage("Friend link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(referral.inviteUrl);
        setShareMessage("Friend link copied.");
      } catch {
        setShareError(true);
        setShareMessage("Copy the friend link from the field.");
      }
    }
  }

  return (
    <main className="player-home-shell">
      <header className="topbar player-home-topbar">
        <Brand />
        <PlayerHandle className="player-handle" username={account.username} />
      </header>
      <section className="player-home-hero">
        <div><p>WELCOME BACK</p><h1>Your next move.</h1></div>
        <div className="player-home-actions">
          <Link className="primary-button" href="/app?mode=multiplayer">CHALLENGE A FRIEND</Link>
          <Link className="secondary-button" href="/app?mode=solo">PLAY RIOT BOT</Link>
          <Link className="secondary-button" href="/worlds">WORLDS</Link>
          <Link className="secondary-button" href="/history">GAME HISTORY</Link>
        </div>
      </section>

      <section className="player-home-grid">
        <div className="dashboard-card matches-card">
          <header><div><small>YOUR GAMES</small><h2>Continue playing</h2></div><Link href="/history">VIEW ALL</Link></header>
          {loading && !games.length ? <p className="dashboard-loading" role="status">LOADING YOUR GAMES…</p> : games.length ? <div className="dashboard-game-list">{games.map((game) => {
            const incomingChallenge = game.mode === "multiplayer"
              && game.status === "waiting"
              && game.color === "b"
              && Boolean(game.opponent);
            const detail = gameDetail(game);
            const identity = game.mode === "solo"
              ? "Riot Bot"
              : game.opponent ? `@${game.opponent}` : "Invitation awaiting player";
            const pace = game.mode === "multiplayer" && game.turnPaceDays
              ? `${game.turnPaceDays} ${game.turnPaceDays === 1 ? "day" : "days"} per move`
              : null;
            const summary = <>
              <span className={`mini-piece ${game.color === "w" ? "light" : "dark"}`}><ChessPiece type="p" color={game.color} /></span>
              <span><strong><bdi dir="auto">{identity}</bdi></strong><small>
                {gameVariant(game.variantId).name}{game.isMagic ? " · Magic" : ""}{pace ? ` · ${pace}` : ""} · {detail}
              </small></span>
            </>;
            return incomingChallenge ? (
              <div className="dashboard-game dashboard-challenge" key={game.id}>
                {summary}
                <div className="dashboard-challenge-actions" aria-label={`Challenge from ${identity}${pace ? `, ${pace}` : ""}`}>
                  <button type="button" disabled={challengeBusy !== null}
                    aria-label={`Accept challenge from ${identity}`}
                    onClick={() => void answerChallenge(game, "accept")}>ACCEPT AS BLACK</button>
                  <button type="button" disabled={challengeBusy !== null}
                    aria-label={`Decline challenge from ${identity}`}
                    onClick={() => void answerChallenge(game, "decline")}>DECLINE</button>
                </div>
              </div>
            ) : (
              <Link href={`/g/${game.id}`} className="dashboard-game" key={game.id}>
                {summary}<b aria-hidden="true">→</b>
              </Link>
            );
          })}</div> : <div className="dashboard-empty"><span>♟</span><p>No active games yet.</p><Link href="/app?mode=multiplayer">CHALLENGE A FRIEND</Link></div>}
          {challengeMessage ? <p className={challengeError ? "form-error" : "form-success"}
            role={challengeError ? "alert" : "status"}>{challengeMessage}</p> : null}
        </div>

        <div className="dashboard-card friends-card">
          <header><div><small>FRIENDS</small><h2>Challenge your people</h2></div><span>{friends.length}</span></header>
          {referral ? <section className="referral-share" lang="en" dir="ltr" translate="no" aria-label="Friend link for inviting a new player">
            <div className="referral-share-heading">
              <div><strong>Your friend link</strong><small>{referral.creditsPerSignup} credits per new player</small></div>
              <span><b>{referral.credits}</b> credits · {referral.invitedPlayers} joined</span>
            </div>
            <div className="referral-share-controls">
              <input
                aria-label="Your personal friend invitation link"
                value={referral.inviteUrl}
                dir="ltr"
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" onClick={() => void shareInvite()}>Share friend link</button>
            </div>
            {shareMessage ? <small className={shareError ? "form-error" : "form-success"}
              role={shareError ? "alert" : "status"}>{shareMessage}</small> : null}
          </section> : null}
          {incoming.length ? <div className="friend-requests"><strong>REQUESTS</strong>{incoming.map((request) => (
            <div key={request.id}><PlayerHandle username={request.username} /><div>
              <button type="button" disabled={friendBusy} aria-label={`Accept friend request from ${request.username}`} onClick={() => void answerRequest(request.id, "accept")}>ACCEPT</button>
              <button type="button" disabled={friendBusy} aria-label={`Decline friend request from ${request.username}`} onClick={() => void answerRequest(request.id, "decline")}>×</button>
              <button className="friend-safety-button" type="button" disabled={friendBusy} aria-label={`Safety options for ${request.username}`} onClick={() => setSafetyTarget({ username: request.username, canRemove: false })}>•••</button>
            </div></div>
          ))}</div> : null}
          <form className="friend-search" onSubmit={addFriend} noValidate>
            <label htmlFor="friend-username">ADD BY USERNAME</label>
            <div><span aria-hidden="true">@</span><input id="friend-username" value={friendUsername} placeholder="username"
              type="text" inputMode="text" enterKeyHint="send" dir="auto" autoComplete="off"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={friendBusy}
              aria-invalid={friendError || undefined}
              aria-describedby={friendMessage ? "friend-username-message" : undefined}
              onChange={(event) => { setFriendUsername(event.target.value); setFriendMessage(""); setFriendError(false); }} />
              <button type="submit" disabled={friendBusy || !friendUsername.trim()}>SEND</button></div>
          </form>
          {friendMessage ? <p id="friend-username-message" className={friendError ? "form-error" : "form-success"} role={friendError ? "alert" : "status"}>{friendMessage}</p> : null}
          {friends.length ? <div className="friend-list">{friends.map((username) => (
            <div key={username}><PlayerHandle username={username} /><div className="friend-row-actions"><Link href={`/app?mode=multiplayer&opponent=${encodeURIComponent(username)}`}>CHALLENGE</Link><button type="button" aria-label={`Safety options for ${username}`} onClick={() => setSafetyTarget({ username, canRemove: true })}>•••</button></div></div>
          ))}</div> : <p className="friends-empty">Add a friend to challenge them in one tap.</p>}
          {outgoing.length ? <div className="pending-friends"><strong>PENDING</strong>{outgoing.map((request) => <div key={request.id}><PlayerHandle username={request.username} /><button type="button" disabled={friendBusy} onClick={() => void cancelRequest(request.id, request.username)}>CANCEL</button></div>)}</div> : null}
        </div>
      </section>
      {loadError ? <div className="dashboard-refresh-error" role="status"><span>{loadError}</span><button type="button" onClick={() => void refresh()}>RETRY</button></div> : null}
      {safetyTarget ? <PlayerSafetyDialog
        username={safetyTarget.username}
        canRemove={safetyTarget.canRemove}
        onClose={() => setSafetyTarget(null)}
        onChanged={() => void refresh()}
      /> : null}
    </main>
  );
}
