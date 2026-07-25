"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasUnseenRelease,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASE_SEEN_KEY,
  releaseTarget,
} from "@/lib/pwa";
import { APP_VERSION } from "@/lib/version";
import styles from "./AppUpdates.module.css";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface HealthPayload {
  version?: unknown;
}

function storedValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings remain active in this tab when browser storage is unavailable.
  }
}

export function AppUpdates() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseDot, setReleaseDot] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  const checkRelease = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as HealthPayload;
      if (typeof data.version !== "string") return;
      const nextAvailable = data.version === APP_VERSION ? null : data.version;
      setAvailableVersion(nextAvailable);
      setReleaseDot(hasUnseenRelease(
        APP_VERSION,
        storedValue(RELEASE_SEEN_KEY),
        nextAvailable,
      ));
    } catch {
      // Release discovery is an enhancement and must never block the app.
    }
  }, []);

  useEffect(() => {
    const seen = storedValue(RELEASE_SEEN_KEY);
    if (seen === null) storeValue(RELEASE_SEEN_KEY, APP_VERSION);
    setReleaseDot(hasUnseenRelease(APP_VERSION, seen, null));
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).then((registration) => registration.update()).catch(() => {
        // Installation remains optional when registration is blocked.
      });
    }

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    void checkRelease();
    const releaseTimer = window.setInterval(checkRelease, RELEASE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(releaseTimer);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [checkRelease]);

  function openDialog() {
    const target = releaseTarget(APP_VERSION, availableVersion);
    storeValue(RELEASE_SEEN_KEY, target);
    setReleaseDot(false);
    setDialogOpen(true);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <>
      <button
        className={styles.launcher}
        type="button"
        ref={triggerRef}
        aria-label={releaseDot
          ? "App updates, new release available"
          : "App updates"}
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        title="App updates"
        onClick={openDialog}
      >
        <span aria-hidden="true">♟</span>
        {releaseDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      </button>
      <dialog
        className={styles.dialog}
        ref={dialogRef}
        aria-labelledby="app-updates-title"
        onClose={() => {
          setDialogOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <div className={styles.card}>
          <div className={styles.heading}>
            <div>
              <p>APP</p>
              <h2 id="app-updates-title">ChessRiot</h2>
            </div>
            <button className={styles.close} type="button" onClick={closeDialog} aria-label="Close">×</button>
          </div>

          <section className={styles.section} aria-labelledby="release-settings-title">
            <h3 id="release-settings-title">Release updates</h3>
            <p>
              {availableVersion
                ? `v${availableVersion} is ready. Reload to use it.`
                : `You are using v${APP_VERSION}.`}
            </p>
            {availableVersion ? (
              <button className={styles.action} type="button" onClick={() => window.location.reload()}>
                RELOAD UPDATE
              </button>
            ) : null}
            <p><Link href="/changelog" onClick={closeDialog}>See what changed</Link></p>
          </section>

          <section className={styles.section} aria-labelledby="install-settings-title">
            <h3 id="install-settings-title">Install app</h3>
            <p>
              {installed
                ? "ChessRiot is running as an installed app."
                : "Install ChessRiot from your browser for a desktop-style window. Gameplay remains online-only."}
            </p>
            {!installed && installPrompt ? (
              <button className={styles.action} type="button" onClick={() => void installApp()}>
                INSTALL CHESSRIOT
              </button>
            ) : null}
          </section>
        </div>
      </dialog>
    </>
  );
}
