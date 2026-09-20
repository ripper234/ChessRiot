"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonWithReadTimeout } from "@/lib/client-recovery";
import { AccountGate, useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";
import { PlayerHandle } from "./PlayerHandle";

interface ReferralInviteProps {
  code: string;
  inviterUsername: string;
  creditsPerSignup: number;
}

interface SessionPayload {
  available?: unknown;
  signedIn?: unknown;
}

interface ClaimPayload {
  state?: unknown;
  inviterUsername?: unknown;
  creditsAwarded?: unknown;
}

type SessionState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "signed_out"; available: boolean }
  | { kind: "signed_in" };

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell referral-invite-shell" lang="en" dir="ltr" translate="no">
      <header className="topbar"><Brand locale="en" /></header>
      <div className="auth-stage">{children}</div>
    </main>
  );
}

function ConnectedInvite({ code, expectedInviter }: {
  code: string;
  expectedInviter: string;
}) {
  const account = useAccountSession();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [inviterUsername, setInviterUsername] = useState(expectedInviter);
  const request = useRef<AbortController | null>(null);
  const attempt = useRef(0);

  const connect = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const attemptId = ++attempt.current;
    setStatus("loading");
    setMessage("");
    try {
      const { response, data: payload } = await fetchJsonWithReadTimeout<ClaimPayload>(
        `/api/referrals/${encodeURIComponent(code)}/claim`,
        {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || attempt.current !== attemptId) return;
      if (!response.ok || !payload) throw new Error();
      if (typeof payload.inviterUsername === "string") {
        setInviterUsername(payload.inviterUsername);
      }
      setStatus("ready");
    } catch {
      if (controller.signal.aborted || attempt.current !== attemptId) return;
      setMessage("We could not confirm the connection. You may already be connected, so it is safe to try again.");
      setStatus("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [code]);

  useEffect(() => {
    void connect();
    return () => {
      attempt.current += 1;
      request.current?.abort();
      request.current = null;
    };
  }, [connect]);

  return (
    <InviteShell>
      <section className="auth-card referral-invite-card">
        <span className="auth-glyph" aria-hidden="true">♞</span>
        <p className="auth-kicker">Friend invitation</p>
        {status === "loading" ? <>
          <h1>Connecting players…</h1>
          <p role="status">Adding <PlayerHandle username={inviterUsername} /> and <PlayerHandle username={account.username} /> to each other’s friend lists.</p>
          <p>This adds a friend. It does not join an existing game.</p>
          <button className="primary-button" type="button" onClick={() => void connect()}>Try again</button>
          <Link className="secondary-button" href="/">Back to home</Link>
        </> : status === "error" ? <>
          <h1>Connection interrupted</h1>
          <p className="form-error" role="alert">{message}</p>
          <button className="primary-button" type="button" onClick={() => void connect()}>Try again</button>
          <Link className="secondary-button" href="/">Back to home</Link>
        </> : <>
          <h1>You are connected.</h1>
          <p><PlayerHandle username={inviterUsername} /> is now on your friend list. You can start a game together.</p>
          <Link className="primary-button" href={`/app?opponent=${encodeURIComponent(inviterUsername)}`}>
            Start a game with <PlayerHandle username={inviterUsername} />
          </Link>
          <Link className="secondary-button" href="/">Back to home</Link>
        </>}
      </section>
    </InviteShell>
  );
}

function SignedInInvite({ code, inviterUsername }: {
  code: string;
  inviterUsername: string;
}) {
  return (
    <AccountGate>
      <ConnectedInvite code={code} expectedInviter={inviterUsername} />
    </AccountGate>
  );
}

export function ReferralInvite({ code, inviterUsername, creditsPerSignup }: ReferralInviteProps) {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const request = useRef<AbortController | null>(null);
  const attempt = useRef(0);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const attemptId = ++attempt.current;
    setSession({ kind: "loading" });
    try {
      const { response, data: payload } = await fetchJsonWithReadTimeout<SessionPayload>(
        "/api/auth/session",
        {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || attempt.current !== attemptId) return;
      if (!response.ok || !payload) throw new Error();
      setSession(payload.signedIn === true
        ? { kind: "signed_in" }
        : { kind: "signed_out", available: payload.available === true });
    } catch {
      if (controller.signal.aborted || attempt.current !== attemptId) return;
      setSession({ kind: "error" });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      attempt.current += 1;
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  if (session.kind === "signed_in") {
    return <SignedInInvite
      code={code}
      inviterUsername={inviterUsername}
    />;
  }

  function startGoogleLogin() {
    const returnTo = `/invite/${code}`;
    window.location.assign(`/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
  }

  return (
    <InviteShell>
      <section className="auth-card referral-invite-card">
        <span className="auth-glyph" aria-hidden="true">♞</span>
        <p className="auth-kicker">Friend invitation</p>
        {session.kind === "loading" ? <>
          <h1>Opening link…</h1>
          <p role="status">Finding <PlayerHandle username={inviterUsername} />.</p>
          <p>This adds a friend. It does not join an existing game.</p>
          <button className="primary-button" type="button" onClick={() => void refresh()}>Try again</button>
          <Link className="secondary-button" href="/">Back to home</Link>
        </> : session.kind === "error" ? <>
          <h1>Could not connect</h1>
          <p className="form-error" role="alert">The link has not opened. Check your connection and try again.</p>
          <button className="primary-button" type="button" onClick={() => void refresh()}>Try again</button>
          <Link className="secondary-button" href="/">Back to home</Link>
        </> : <>
          <h1>Add <PlayerHandle username={inviterUsername} /> as a friend.</h1>
          <p>After sign-in, you will be added to each other’s friend lists automatically. This does not join an existing game. <PlayerHandle username={inviterUsername} /> receives {creditsPerSignup} credits if you create a new account.</p>
          <button className="google-sign-in" type="button" disabled={!session.available} onClick={startGoogleLogin}>
            <span aria-hidden="true">G</span>
            Continue with Google
          </button>
          {!session.available ? <p className="form-error">Google sign-in is unavailable right now.</p> : null}
          <small className="auth-legal">
            By continuing, you agree to the <Link href="/terms">Terms of Use</Link> and confirm that you have read the <Link href="/privacy">Privacy Policy</Link>.
          </small>
        </>}
      </section>
    </InviteShell>
  );
}
