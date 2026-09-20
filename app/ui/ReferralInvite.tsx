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
    <main className="auth-shell referral-invite-shell" lang="he" dir="rtl" translate="no">
      <header className="topbar"><Brand locale="he" /></header>
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
      setMessage("לא הצלחנו להשלים את החיבור. ייתכן שהוא כבר בוצע, ולכן אפשר לנסות שוב בבטחה.");
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
        <p className="auth-kicker">קישור לחיבור בין שחקנים</p>
        {status === "loading" ? <>
          <h1>מחבר בין השחקנים…</h1>
          <p role="status">מוסיף את <PlayerHandle username={inviterUsername} /> ואת <PlayerHandle username={account.username} /> לרשימות החברים זה של זה.</p>
          <p>זהו קישור לחברים, לא הזמנה למשחק קיים.</p>
          <button className="primary-button" type="button" onClick={() => void connect()}>ניסיון נוסף</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </> : status === "error" ? <>
          <h1>החיבור נעצר</h1>
          <p className="form-error" role="alert">{message}</p>
          <button className="primary-button" type="button" onClick={() => void connect()}>ניסיון נוסף</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </> : <>
          <h1>אתם מחוברים.</h1>
          <p><PlayerHandle username={inviterUsername} /> נוסף לרשימת החברים. עכשיו אפשר ליצור משחק חדש.</p>
          <Link className="primary-button" href={`/app?opponent=${encodeURIComponent(inviterUsername)}`}>
            יצירת משחק מול <PlayerHandle username={inviterUsername} />
          </Link>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
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
        <p className="auth-kicker">קישור לחיבור בין שחקנים</p>
        {session.kind === "loading" ? <>
          <h1>פותח את הקישור…</h1>
          <p role="status">מאתר את <PlayerHandle username={inviterUsername} />.</p>
          <p>זהו קישור להוספת חבר, לא הזמנה למשחק קיים.</p>
          <button className="primary-button" type="button" onClick={() => void refresh()}>ניסיון נוסף</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </> : session.kind === "error" ? <>
          <h1>לא הצלחנו להתחבר</h1>
          <p className="form-error" role="alert">הקישור עדיין לא נפתח. בדקו את החיבור ונסו שוב.</p>
          <button className="primary-button" type="button" onClick={() => void refresh()}>ניסיון נוסף</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </> : <>
          <h1>להוסיף את <PlayerHandle username={inviterUsername} /> לחברים.</h1>
          <p>לאחר הכניסה תתווספו אוטומטית לרשימות החברים. זה אינו מצרף אתכם למשחק קיים. <PlayerHandle username={inviterUsername} /> יקבל {creditsPerSignup} קרדיטים אם זהו חשבון חדש.</p>
          <button className="google-sign-in" type="button" disabled={!session.available} onClick={startGoogleLogin}>
            <span aria-hidden="true">G</span>
            המשך עם Google
          </button>
          {!session.available ? <p className="form-error">הכניסה עם Google אינה זמינה כרגע.</p> : null}
          <small className="auth-legal">
            בהמשך הפעולה אתם מסכימים ל<Link href="/terms">תנאי השימוש</Link> ומאשרים שקראתם את <Link href="/privacy">מדיניות הפרטיות</Link>.
          </small>
        </>}
      </section>
    </InviteShell>
  );
}
