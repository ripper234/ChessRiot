"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasUnseenRelease,
  MOVE_CHECK_INTERVAL_MS,
  MOVE_NOTIFICATIONS_KEY,
  opponentMovedSince,
  parseEnabledPreference,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASE_SEEN_KEY,
  releaseTarget,
  type WatchedAccountGame,
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

interface AccountGamesPage {
  games?: WatchedAccountGame[];
  nextCursor?: string | null;
}

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
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

async function showMoveNotification(game: WatchedAccountGame): Promise<void> {
  const pathname = `/g/${encodeURIComponent(game.id)}`;
  const opponent = game.opponent?.trim() || "Your opponent";
  const options: NotificationOptions = {
    body: game.status === "completed"
      ? "Open ChessRiot to see how the game ended."
      : "It’s your turn in ChessRiot.",
    icon: "/icons/chessriot-192.png",
    badge: "/icons/chessriot-192.png",
    tag: `chessriot-move:${game.id}`,
    data: { path: pathname },
  };
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (registration?.active) {
        await registration.showNotification("Your opponent moved", options);
        return;
      }
    } catch {
      // Fall back to a page notification when service workers are unavailable.
    }
  }
  new Notification(`${opponent} moved`, options);
}

async function loadWatchedGames(): Promise<WatchedAccountGame[] | null> {
  const games: WatchedAccountGame[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ view: "watch", limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`/api/me/games?${query}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as AccountGamesPage;
    if (!Array.isArray(data.games)) return null;
    games.push(...data.games);
    cursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
    if (!cursor) return games;
  }
  return games;
}

export function AppUpdates() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const watchedGamesRef = useRef<Map<string, WatchedAccountGame> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseDot, setReleaseDot] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
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
    setNotificationsEnabled(parseEnabledPreference(storedValue(MOVE_NOTIFICATIONS_KEY)));
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

  useEffect(() => {
    if (
      !notificationsEnabled
      || !canNotify()
      || Notification.permission !== "granted"
    ) {
      watchedGamesRef.current = null;
      return;
    }

    let stopped = false;
    const checkGames = async () => {
      try {
        const games = await loadWatchedGames();
        if (stopped || !games) return;
        const previous = watchedGamesRef.current;
        const next = new Map(games.map((game) => [game.id, game]));
        watchedGamesRef.current = next;
        if (!previous || (document.visibilityState === "visible" && document.hasFocus())) {
          return;
        }
        const changed = games
          .filter((game) => opponentMovedSince(previous.get(game.id), game))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, 3);
        for (const game of changed) await showMoveNotification(game);
      } catch {
        // Game screens own connection status; this background convenience stays quiet.
      }
    };

    void checkGames();
    const timer = window.setInterval(checkGames, MOVE_CHECK_INTERVAL_MS);
    window.addEventListener("online", checkGames);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("online", checkGames);
    };
  }, [notificationsEnabled]);

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

  async function toggleNotifications() {
    if (notificationsEnabled) {
      storeValue(MOVE_NOTIFICATIONS_KEY, "false");
      setNotificationsEnabled(false);
      setNotificationMessage("Opponent move notifications are off.");
      return;
    }
    if (!canNotify()) {
      setNotificationMessage("This browser does not support notifications.");
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") {
      storeValue(MOVE_NOTIFICATIONS_KEY, "false");
      setNotificationMessage(
        permission === "denied"
          ? "Notifications are blocked in this browser’s site settings."
          : "Notifications remain off.",
      );
      return;
    }
    storeValue(MOVE_NOTIFICATIONS_KEY, "true");
    setNotificationsEnabled(true);
    setNotificationMessage("Opponent move notifications are on.");
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
          ? "App updates and notifications, new release available"
          : "App updates and notifications"}
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        title="App updates and notifications"
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
              <p>APP &amp; ALERTS</p>
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

          <section className={styles.section} aria-labelledby="notification-settings-title">
            <h3 id="notification-settings-title">Opponent moves</h3>
            <p>
              Get alerts for all your multiplayer games across devices while
              ChessRiot remains open in another tab or window.
            </p>
            <button
              className={styles.action}
              type="button"
              data-enabled={notificationsEnabled ? "true" : "false"}
              aria-pressed={notificationsEnabled}
              onClick={() => void toggleNotifications()}
            >
              {notificationsEnabled ? "NOTIFICATIONS ON" : "TURN NOTIFICATIONS ON"}
            </button>
            {notificationMessage ? <p className={styles.note} role="status">{notificationMessage}</p> : null}
            <p>
              No closed-app push is claimed or enabled. A suspended or closed browser
              cannot check for moves.
            </p>
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
