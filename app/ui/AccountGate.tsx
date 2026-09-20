"use client";

import Link from "next/link";
import {
  createContext,
  FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AUTH_SESSION_INVALIDATED_EVENT,
  publishAuthSessionChanged,
} from "@/lib/auth-session-client";
import {
  fetchJsonWithReadTimeout,
  recoveryDelayMs,
} from "@/lib/client-recovery";
import { reportProductEvent } from "@/lib/client-telemetry";
import { playerKey, readSeatTokenFromHash } from "@/lib/client-storage";
import {
  claimBrowserNotificationOnboarding,
  completedNotificationOnboardingDecision,
  notificationOnboardingWasSeen,
  notificationPermissionWasAttempted,
  shouldEnterNotificationPermissionFlow,
  synchronizeTerminalNotificationPermission,
} from "@/lib/notification-permission";
import { notificationOfferDecisionKey, PUSH_DEVICE_OWNER_KEY } from "@/lib/pwa";
import {
  preparePushServiceWorker,
  registerPushDevice,
  settlePushRegistrationChoice,
} from "@/lib/push-registration-client";
import { validateUsername } from "@/lib/usernames";
import { Brand } from "./Brand";
import { ActivityInbox } from "./ActivityInbox";
import { QuickStartTutorial } from "./QuickStartTutorial";

export interface AccountSession {
  displayName: string;
  username: string;
  features: { magicRules: boolean };
  featureRequests: { magicRules: "pending" | null };
  tutorialStatus: "pending" | "completed" | "skipped";
}

interface SessionPayload {
  available?: unknown;
  signedIn?: unknown;
  needsUsername?: unknown;
  account?: {
    displayName?: unknown;
    username?: unknown;
    tutorialStatus?: unknown;
  } | null;
  features?: { magicRules?: unknown } | null;
  featureRequests?: { magicRules?: unknown } | null;
}

type GateState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signed_out"; available: boolean }
  | { kind: "username"; displayName: string }
  | { kind: "notifications"; session: AccountSession }
  | { kind: "ready"; session: AccountSession };

const AccountSessionContext = createContext<AccountSession | null>(null);
function notificationDecision(username: string): string | null {
  try {
    return localStorage.getItem(notificationOfferDecisionKey(username));
  } catch {
    return null;
  }
}

function writeNotificationDecision(username: string, decision: string): void {
  try {
    localStorage.setItem(notificationOfferDecisionKey(username), decision);
  } catch {
    // The onboarding step remains usable when private storage is unavailable.
  }
}

function usernameValidationMessage(
  validation: Exclude<ReturnType<typeof validateUsername>, { ok: true }>,
): string {
  if (validation.code === "required") return "בחרו שם משתמש.";
  if (validation.code === "length") return "השתמשו ב־3–20 תווים.";
  if (validation.code === "characters") {
    return "התחילו באות והשתמשו באותיות מכל שפה, מספרים, נקודות, מקפים או קווים תחתיים.";
  }
  if (validation.code === "reserved") return "שם המשתמש הזה שמור. בחרו שם אחר.";
  return "בחרו שם משתמש שמתאים לכולם.";
}

function shouldRunNotificationPermissionStep(
  accountDecision: string | null = null,
): boolean {
  const supported = "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && typeof ServiceWorkerRegistration !== "undefined"
    && "showNotification" in ServiceWorkerRegistration.prototype;
  if (!supported) return false;
  synchronizeTerminalNotificationPermission(Notification.permission);
  return shouldEnterNotificationPermissionFlow({
    supported,
    permission: Notification.permission,
    attempted: notificationPermissionWasAttempted(),
    accountDecision,
    onboardingSeen: notificationOnboardingWasSeen(),
  });
}

async function claimNotificationOnboardingFailOpen(): Promise<boolean> {
  try {
    return await claimBrowserNotificationOnboarding();
  } catch {
    return false;
  }
}

export function useAccountSession(): AccountSession {
  const value = useContext(AccountSessionContext);
  if (!value) throw new Error("useAccountSession must be used inside AccountGate");
  return value;
}

function sessionState(payload: SessionPayload): GateState {
  if (payload.signedIn !== true) {
    return { kind: "signed_out", available: payload.available === true };
  }
  const displayName = typeof payload.account?.displayName === "string"
    ? payload.account.displayName
    : "Player";
  const username = typeof payload.account?.username === "string"
    ? payload.account.username
    : null;
  if (!username || payload.needsUsername === true) {
    return { kind: "username", displayName };
  }
  return {
    kind: "ready",
    session: {
      displayName,
      username,
      features: { magicRules: payload.features?.magicRules === true },
      featureRequests: {
        magicRules: payload.featureRequests?.magicRules === "pending" ? "pending" : null,
      },
      tutorialStatus: payload.account?.tutorialStatus === "pending"
        ? "pending"
        : payload.account?.tutorialStatus === "completed"
          ? "completed"
          : "skipped",
    },
  };
}

export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const sessionRead = useRef<Promise<"ready" | "error"> | null>(null);

  const refresh = useCallback((showLoading = true) => {
    if (sessionRead.current) return sessionRead.current;
    if (showLoading) setState({ kind: "loading" });
    const operation = (async (): Promise<"ready" | "error"> => {
      try {
        const { response, data } = await fetchJsonWithReadTimeout<SessionPayload>("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok || !data) throw new Error();
        const resolved = sessionState(data);
        let next = resolved;
        if (resolved.kind === "ready") {
          const decision = notificationDecision(resolved.session.username);
          if (
            shouldRunNotificationPermissionStep(decision)
            && await claimNotificationOnboardingFailOpen()
          ) {
            writeNotificationDecision(resolved.session.username, "onboarding");
            next = { kind: "notifications" as const, session: resolved.session };
          }
        }
        setState(next);
        publishAuthSessionChanged(next.kind === "ready" || next.kind === "username");
        return "ready";
      } catch {
        setState({
          kind: "error",
          message: "לא הצלחנו לטעון את החשבון. בדקו את החיבור ונסו שוב.",
        });
        return "error";
      }
    })();
    sessionRead.current = operation;
    void operation.finally(() => {
      if (sessionRead.current === operation) sessionRead.current = null;
    });
    return operation;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const replay = (event: Event) => {
      if (state.kind !== "ready") return;
      event.preventDefault();
      setTutorialOpen(true);
    };
    window.addEventListener("chessriot:replay-tutorial", replay);
    return () => window.removeEventListener("chessriot:replay-tutorial", replay);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "ready") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tutorial") !== "1") return;
    setTutorialOpen(true);
    url.searchParams.delete("tutorial");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "error") return;
    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
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
        const result = await refresh(false);
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
    window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, recover);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, recover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, state.kind]);

  useEffect(() => {
    if (state.kind === "error") return;
    const recheck = () => void refresh(false);
    window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, recheck);
    return () => window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, recheck);
  }, [refresh, state.kind]);

  if (state.kind === "loading") {
    return <GateShell><div className="auth-loading" role="status">פותחים את הזירה… <Link className="quiet-button" href="/">חזרה לדף הבית</Link></div></GateShell>;
  }
  if (state.kind === "error") {
    return (
      <GateShell>
        <section className="auth-card" role="alert">
          <span className="auth-glyph" aria-hidden="true">↻</span>
          <h1>החיבור לא הצליח</h1>
          <p>{state.message} נמשיך לנסות אוטומטית.</p>
          <button className="primary-button" type="button" onClick={() => void refresh()}>נסו שוב</button>
          <Link className="secondary-button" href="/">חזרה לדף הבית</Link>
        </section>
      </GateShell>
    );
  }
  if (state.kind === "signed_out") {
    return <SignInScreen available={state.available} />;
  }
  if (state.kind === "username") {
    return <UsernameScreen displayName={state.displayName} onComplete={setState} />;
  }
  if (state.kind === "notifications") {
    return <NotificationOnboarding
      session={state.session}
      onComplete={() => setState({ kind: "ready", session: state.session })}
    />;
  }
  return (
    <AccountSessionContext.Provider value={state.session}>
      <ActivityInbox />
      {children}
      {tutorialOpen ? (
        <QuickStartTutorial onDone={(tutorialStatus) => {
          setState({
            kind: "ready",
            session: { ...state.session, tutorialStatus },
          });
          setTutorialOpen(false);
        }} />
      ) : null}
    </AccountSessionContext.Provider>
  );
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell" lang="he" dir="rtl" translate="no">
      <header className="topbar"><Brand locale="he" /></header>
      <div className="auth-stage">{children}</div>
    </main>
  );
}

function rememberPrivateSeat(): void {
  const match = /^\/g\/([0-9a-f-]{36})$/i.exec(window.location.pathname);
  const token = readSeatTokenFromHash(window.location.hash);
  if (!match || !token) return;
  try {
    localStorage.setItem(playerKey(match[1]), token);
  } catch {
    // The user can reopen the original link if private storage is blocked.
  }
}

function SignInScreen({ available }: { available: boolean }) {
  function startGoogleLogin() {
    rememberPrivateSeat();
    reportProductEvent("auth.started");
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
  }
  return (
    <GateShell>
      <section className="auth-card sign-in-card">
        <span className="auth-glyph" aria-hidden="true">♞</span>
        <p className="auth-kicker">חשבון ChessRiot שלך</p>
        <h1>נכנסים ומשחקים</h1>
        <p>כל המשחקים, החברים וההתקדמות נשמרים יחד בכל מכשיר.</p>
        <button
          className="google-sign-in"
          type="button"
          disabled={!available}
          onClick={startGoogleLogin}
        >
          <span aria-hidden="true">G</span>
          המשך עם Google
        </button>
        {!available ? <p className="form-error">הכניסה עם Google אינה זמינה כרגע.</p> : null}
        <small className="auth-legal">
          בהמשך הפעולה אתם מסכימים ל<Link href="/terms">תנאים</Link> ומאשרים שקראתם את <Link href="/privacy">מדיניות הפרטיות</Link>.
        </small>
      </section>
    </GateShell>
  );
}

function UsernameScreen({
  displayName,
  onComplete,
}: {
  displayName: string;
  onComplete: (state: GateState) => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [validationVisible, setValidationVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const usernameValidation = validateUsername(username);
  const validationError = validationVisible && !usernameValidation.ok
    ? usernameValidationMessage(usernameValidation)
    : "";
  const visibleError = error || validationError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setValidationVisible(true);
    const validated = validateUsername(username);
    if (!validated.ok) {
      setError(usernameValidationMessage(validated));
      return;
    }
    if (!confirmed) {
      setError(`אשרו ש־@${validated.username} הוא שם המשתמש הקבוע הרצוי.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/me/username", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: validated.username }),
      });
      const payload = await response.json() as {
        account?: { displayName?: unknown; username?: unknown };
        tutorialStatus?: unknown;
        features?: { magicRules?: unknown };
        featureRequests?: { magicRules?: unknown };
        error?: { code?: unknown; message?: unknown };
      };
      if (!response.ok || typeof payload.account?.username !== "string") {
        setError(payload.error?.code === "unavailable"
          ? "שם המשתמש הזה כבר תפוס. בחרו שם אחר."
          : payload.error?.code === "rate_limited"
            ? "בוצעו יותר מדי ניסיונות. נסו שוב מאוחר יותר."
            : payload.error?.code === "already_set"
              ? "כבר נבחר שם משתמש לחשבון הזה."
              : "לא הצלחנו לשמור את שם המשתמש.");
        return;
      }
      publishAuthSessionChanged(true);
      const session: AccountSession = {
        displayName: typeof payload.account.displayName === "string"
          ? payload.account.displayName
          : displayName,
        username: payload.account.username,
        features: { magicRules: payload.features?.magicRules === true },
        featureRequests: {
          magicRules: payload.featureRequests?.magicRules === "pending" ? "pending" : null,
        },
        tutorialStatus: payload.tutorialStatus === "completed"
          ? "completed"
          : payload.tutorialStatus === "skipped"
            ? "skipped"
            : "pending",
      };
      if (
        shouldRunNotificationPermissionStep()
        && await claimNotificationOnboardingFailOpen()
      ) {
        writeNotificationDecision(payload.account.username, "onboarding");
        onComplete({ kind: "notifications", session });
      } else {
        onComplete({ kind: "ready", session });
      }
    } catch {
      setError("לא הצלחנו לשמור את שם המשתמש. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateShell>
      <form className="auth-card username-card" onSubmit={submit} autoComplete="off" noValidate>
        <span className="auth-glyph" aria-hidden="true">@</span>
        <p className="auth-kicker">עוד שלב אחד</p>
        <h1>בחירת שם משתמש</h1>
        <p>חברים יוכלו למצוא ולהזמין אתכם באמצעותו.</p>
        <label htmlFor="account-username">שם משתמש</label>
        <div className="username-field"><span aria-hidden="true">@</span><input
          id="account-username"
          name="chessriotPlayerHandle"
          type="text"
          value={username}
          required
          inputMode="text"
          enterKeyHint="done"
          dir="auto"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(visibleError)}
          aria-describedby={`username-guidance${visibleError ? " username-error" : ""}`}
          disabled={busy}
          onBlur={() => setValidationVisible(true)}
          onChange={(event) => {
            setUsername(event.target.value);
            setConfirmed(false);
            setError("");
          }}
        /></div>
        <small id="username-guidance">3–20 תווים. מתחילים באות. אפשר להשתמש באותיות מכל שפה, מספרים, נקודות, מקפים וקווים תחתיים. שם המשתמש ייחודי וצריך להתאים לכולם.</small>
        <label className="username-confirmation">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy || !usernameValidation.ok}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              setError("");
            }}
          />
          <span>אני מאשר את <strong><span aria-hidden="true">@</span><bdi dir="auto">{username || "שם-משתמש"}</bdi></strong>. ברור לי שאפשר לבחור פעם אחת בלבד ולא ניתן לשנות אחר כך.</span>
        </label>
        {visibleError ? <p className="form-error" id="username-error" role="alert" aria-live="polite">{visibleError}</p> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "שומרים…" : "שמירת שם המשתמש"}
        </button>
        <small className="auth-legal">
          <Link href="/terms">תנאים</Link> · <Link href="/privacy">פרטיות</Link>
        </small>
      </form>
    </GateShell>
  );
}

function NotificationOnboarding({
  session,
  onComplete,
}: {
  session: AccountSession;
  onComplete: () => void;
}) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const setupCancelled = useRef(false);

  const finish = useCallback((decision: string) => {
    if (setupCancelled.current) return;
    setupCancelled.current = true;
    const currentDecision = notificationDecision(session.username);
    const resolvedDecision = completedNotificationOnboardingDecision(
      currentDecision,
      decision,
    );
    writeNotificationDecision(session.username, resolvedDecision);
    onComplete();
    window.requestAnimationFrame(() => document.getElementById("route-content")?.focus());
  }, [onComplete, session.username]);

  useEffect(() => {
    let cancelled = false;
    const supported = "serviceWorker" in navigator
      && "PushManager" in window
      && "Notification" in window;
    if (!supported) {
      finish("unavailable");
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      fetchJsonWithReadTimeout<{
        enabled?: unknown;
        publicKey?: unknown;
      }>("/api/push/config", { cache: "no-store" }),
      preparePushServiceWorker(),
    ])
      .then(([result, readyRegistration]) => ({
        config: result.response.ok ? result.data : null,
        readyRegistration,
      }))
      .then(({ config, readyRegistration }) => {
        if (cancelled) return;
        if (config?.enabled !== true || typeof config.publicKey !== "string") {
          finish("unavailable");
          return;
        }
        setPublicKey(config.publicKey);
        setRegistration(readyRegistration);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) finish("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [finish]);

  useEffect(() => () => {
    setupCancelled.current = true;
  }, []);

  async function enableNotifications() {
    if (!publicKey || !registration || busy) return;
    setupCancelled.current = false;
    setBusy(true);
    try {
      const subscription = await registerPushDevice({
        registration,
        publicKey,
        expectedUsername: session.username,
      });
      const settled = await settlePushRegistrationChoice({
        subscription,
        expectedUsername: session.username,
        isCancelled: () => setupCancelled.current,
      });
      if (settled === "cancelled") return;
      try {
        localStorage.setItem(PUSH_DEVICE_OWNER_KEY, session.username);
      } catch {
        // The server registration remains authoritative without local storage.
      }
      writeNotificationDecision(session.username, "enabled");
      if (!setupCancelled.current) finish("enabled");
    } catch {
      if (notificationDecision(session.username) === "onboarding") {
        writeNotificationDecision(session.username, "setup-failed");
      }
      if (!setupCancelled.current) finish("setup-failed");
    } finally {
      if (!setupCancelled.current) setBusy(false);
    }
  }

  return (
    <GateShell>
      <section className="auth-card notification-onboarding-card" aria-labelledby="notification-onboarding-title">
        <span className="auth-glyph" aria-hidden="true">♟</span>
        <p className="auth-kicker">התראות תור</p>
        <h1 id="notification-onboarding-title">לא מפספסים תור.</h1>
        <p>קבלו בקשות חברות, התראות תור והודעות שירות מזדמנות במכשיר הזה, גם כש־ChessRiot סגור.</p>
        <small>לא חובה. ההפעלה תפתח בקשת הרשאה חד־פעמית מהדפדפן. אפשר לבחור לא עכשיו ולהמשיך לשחק בלי התראות. תמיד אפשר לשנות זאת בהגדרות.</small>
        {loading ? <p className="notification-onboarding-status" role="status">בודקים אם אפשר להפעיל התראות…</p> : null}
        <div className="notification-onboarding-actions">
          <button
            className="primary-button"
            type="button"
            disabled={busy || loading || !publicKey || !registration}
            onClick={() => void enableNotifications()}
          >{loading ? "בודקים…" : busy ? "פותחים…" : "הפעלת התראות"}</button>
          <button className="secondary-button" type="button" onClick={() => finish("dismissed")}>לא עכשיו</button>
        </div>
      </section>
    </GateShell>
  );
}
