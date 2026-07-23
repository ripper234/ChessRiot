"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { generateSecret, playerKey, rememberGame } from "@/lib/client-storage";
import type { GameSnapshot } from "@/lib/game-types";
import { Brand } from "./Brand";

type InviteState =
  | { kind: "loading" }
  | { kind: "waiting"; gameId: string; creatorName: string }
  | { kind: "claimed"; gameId?: string }
  | { kind: "missing" };

export function JoinGame({ inviteToken }: { inviteToken: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InviteState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const playerToken = useRef<string | null>(null);

  useEffect(() => {
    setName(localStorage.getItem("chessriot:displayName") ?? "");
    let cancelled = false;
    void fetch(`/api/invitations/${inviteToken}`, { cache: "no-store" }).then(async (response) => {
      const data = (await response.json()) as {
        state?: string;
        gameId?: string;
        creatorName?: string;
      };
      if (cancelled) return;
      if (data.gameId && localStorage.getItem(playerKey(data.gameId))) {
        router.replace(`/g/${data.gameId}`);
        return;
      }
      if (response.ok && data.gameId && data.creatorName) {
        setInvite({ kind: "waiting", gameId: data.gameId, creatorName: data.creatorName });
      } else if (response.status === 410) {
        setInvite({ kind: "claimed", gameId: data.gameId });
      } else {
        setInvite({ kind: "missing" });
      }
    }).catch(() => {
      if (!cancelled) setInvite({ kind: "missing" });
    });
    return () => { cancelled = true; };
  }, [inviteToken, router]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (invite.kind !== "waiting" || !name.trim()) return;
    setBusy(true);
    setError("");
    playerToken.current ??= generateSecret();
    try {
      const response = await fetch(`/api/invitations/${inviteToken}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), playerToken: playerToken.current }),
      });
      const data = (await response.json()) as { game?: GameSnapshot; error?: { message?: string } };
      if (!response.ok || !data.game) throw new Error(data.error?.message ?? "Could not join this game");
      localStorage.setItem("chessriot:displayName", name.trim());
      localStorage.setItem(playerKey(data.game.id), playerToken.current);
      rememberGame(data.game);
      router.replace(`/g/${data.game.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join this game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="join-shell">
      <header className="topbar"><Brand /></header>
      <section className="join-stage">
        <div className="challenge-mark" aria-hidden="true"><span>♜</span><b>VS</b><span>♞</span></div>
        {invite.kind === "loading" ? <div className="voxel-card state-card"><h1>OPENING THE ARENA…</h1></div> : null}
        {invite.kind === "waiting" ? (
          <form className="voxel-card join-card" onSubmit={join}>
            <p className="eyebrow"><span /> PRIVATE CHALLENGE</p>
            <h1><em>{invite.creatorName}</em><br />wants a match.</h1>
            <label htmlFor="join-name">What should they call you?</label>
            <input
              id="join-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                playerToken.current = null;
              }}
              maxLength={24}
              autoComplete="nickname"
              placeholder="Omri"
              disabled={busy}
            />
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="primary-button" disabled={busy || !name.trim()}>
              {busy ? "CLAIMING SEAT…" : "JOIN AS BLACK  →"}
            </button>
            <p className="fine-print">This invitation claims one seat and works once.</p>
          </form>
        ) : null}
        {invite.kind === "claimed" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">⚑</span><h1>SEAT ALREADY CLAIMED</h1>
            <p>That invitation has already been used.</p><Link className="secondary-button" href="/">START ANOTHER GAME</Link>
          </div>
        ) : null}
        {invite.kind === "missing" ? (
          <div className="voxel-card state-card">
            <span className="big-glyph">?</span><h1>INVITATION NOT FOUND</h1>
            <p>Ask the game creator for a fresh link.</p><Link className="secondary-button" href="/">GO HOME</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
