"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonWithReadTimeout, recoveryDelayMs } from "@/lib/client-recovery";
import { AccountGate } from "./AccountGate";
import { PlayerHome } from "./PlayerHome";
import { PublicHome } from "./PublicHome";

export function HomeExperience() {
  const [signedIn, setSignedIn] = useState<boolean | "error" | null>(null);
  const sessionRead = useRef<Promise<"ready" | "error"> | null>(null);
  const refresh = useCallback((showLoading = true) => {
    if (sessionRead.current) return sessionRead.current;
    if (showLoading) setSignedIn(null);
    const operation = (async (): Promise<"ready" | "error"> => {
      try {
        const { response, data: payload } = await fetchJsonWithReadTimeout<{ signedIn?: unknown }>("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok || !payload) throw new Error();
        setSignedIn(payload.signedIn === true);
        return "ready";
      } catch {
        setSignedIn("error");
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
    if (signedIn !== "error") return;
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
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, signedIn]);

  if (signedIn === null) {
    return <main className="public-shell home-resolving" aria-label="Loading ChessRiot" />;
  }
  if (signedIn === "error") {
    return <main className="auth-shell"><div className="auth-stage"><section className="auth-card" role="alert"><span className="auth-glyph" aria-hidden="true">↻</span><h1>Couldn&apos;t connect</h1><p>ChessRiot could not check your account yet. It will keep trying automatically.</p><button className="primary-button" type="button" onClick={() => void refresh()}>TRY AGAIN</button></section></div></main>;
  }
  return signedIn
    ? <AccountGate><PlayerHome /></AccountGate>
    : <PublicHome />;
}
