"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, requestHeaders } from "@/lib/client-http";
import {
  generateUuid,
  playerKey,
  readSeatTokenFromHash,
} from "@/lib/client-storage";
import {
  gameIdFromPathname,
  hasUnseenRelease,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASE_SEEN_KEY,
  releaseTarget,
} from "@/lib/pwa";
import {
  applicationServerKeyBytes,
  browserPushPayload,
  pushEndpointHash,
} from "@/lib/push-client";
import { APP_VERSION } from "@/lib/version";
import styles from "./AppUpdates.module.css";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface HealthPayload {
  version?: unknown;
}

interface PushConfigPayload {
  enabled?: unknown;
  publicKey?: unknown;
}

interface PushStatusPayload {
  available?: unknown;
  enabled?: unknown;
}

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

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
  const pathname = usePathname();
  const activeGameId = gameIdFromPathname(pathname);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseDot, setReleaseDot] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [turnAlertsAvailable, setTurnAlertsAvailable] = useState(true);
  const [turnAlertsEnabled, setTurnAlertsEnabled] = useState(false);
  const [turnAlertsBusy, setTurnAlertsBusy] = useState(false);
  const [turnAlertsMessage, setTurnAlertsMessage] = useState("");

  const getServiceWorkerRegistration = useCallback(async () => {
    if (serviceWorkerRef.current) return serviceWorkerRef.current;
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    if (registration.active) {
      serviceWorkerRef.current = registration;
      return registration;
    }
    const ready = await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The service worker did not become ready.")),
        SERVICE_WORKER_READY_TIMEOUT_MS,
      );
      void navigator.serviceWorker.ready.then(
        (activeRegistration) => {
          window.clearTimeout(timeout);
          resolve(activeRegistration);
        },
        (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      );
    });
    serviceWorkerRef.current = ready;
    return ready;
  }, []);

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
      void getServiceWorkerRegistration().then(async (registration) => {
        await registration.update();
      }).catch(() => {
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
  }, [checkRelease, getServiceWorkerRegistration]);

  useEffect(() => {
    setTurnAlertsMessage("");
    setPushReady(false);
    setPushPublicKey(null);
    setTurnAlertsAvailable(true);
    setTurnAlertsEnabled(false);
    if (!activeGameId) return;
    if (
      !("serviceWorker" in navigator)
      || !("PushManager" in window)
      || !("Notification" in window)
    ) {
      setPushReady(true);
      setPushPublicKey(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/push/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as PushConfigPayload;
      })
      .then(async (config) => {
        if (cancelled) return;
        if (config?.enabled !== true || typeof config.publicKey !== "string") {
          setPushReady(true);
          return;
        }
        setPushPublicKey(config.publicKey);
        const registration = await getServiceWorkerRegistration();
        const subscription = await registration.pushManager.getSubscription();
        const endpointHash = subscription
          ? await pushEndpointHash(subscription.endpoint)
          : null;
        const headers = requestHeaders(activeSeatToken(activeGameId));
        if (endpointHash) headers["x-push-endpoint-hash"] = endpointHash;
        const response = await fetch(
          `/api/games/${encodeURIComponent(activeGameId)}/push-subscriptions`,
          { cache: "no-store", headers },
        );
        if (response.ok) {
          const status = await response.json() as PushStatusPayload;
          if (!cancelled) {
            setTurnAlertsAvailable(status.available !== false);
            setTurnAlertsEnabled(status.enabled === true);
          }
        }
        if (cancelled) return;
        setPushReady(true);
      })
      .catch(() => {
        if (!cancelled) setPushReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeGameId, getServiceWorkerRegistration]);

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

  function activeSeatToken(gameId: string): string | null {
    const linked = readSeatTokenFromHash(window.location.hash);
    if (linked) return linked;
    try {
      return localStorage.getItem(playerKey(gameId));
    } catch {
      return null;
    }
  }

  async function enableTurnAlerts() {
    if (!activeGameId || !pushPublicKey || turnAlertsBusy) return;
    setTurnAlertsBusy(true);
    setTurnAlertsMessage("");
    let created: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setTurnAlertsMessage("Notification permission was not granted.");
        return;
      }
      const registration = await getServiceWorkerRegistration();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKeyBytes(pushPublicKey),
      });
      if (!existing) created = subscription;
      const payload = browserPushPayload(subscription);
      if (!payload) throw new Error("This browser returned an incomplete subscription.");
      const response = await fetch(
        `/api/games/${encodeURIComponent(activeGameId)}/push-subscriptions`,
        {
          method: "PUT",
          headers: requestHeaders(activeSeatToken(activeGameId), true),
          body: JSON.stringify({
            requestId: generateUuid(),
            subscription: payload,
          }),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Turn alerts could not be enabled."));
      }
      setTurnAlertsEnabled(true);
      setTurnAlertsMessage("This device will alert you when it is your turn in this game.");
    } catch (error) {
      if (created) await created.unsubscribe().catch(() => false);
      setTurnAlertsEnabled(false);
      setTurnAlertsMessage(
        error instanceof Error
          ? error.message
          : "Turn alerts could not be enabled in this browser.",
      );
    } finally {
      setTurnAlertsBusy(false);
    }
  }

  async function disableTurnAlerts() {
    if (!activeGameId || turnAlertsBusy) return;
    setTurnAlertsBusy(true);
    setTurnAlertsMessage("");
    try {
      const registration = await getServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const payload = browserPushPayload(subscription);
        if (!payload) {
          throw new Error("This browser returned an incomplete subscription.");
        }
        const response = await fetch(
          `/api/games/${encodeURIComponent(activeGameId)}/push-subscriptions`,
          {
            method: "DELETE",
            headers: requestHeaders(activeSeatToken(activeGameId), true),
            body: JSON.stringify({
              requestId: generateUuid(),
              endpoint: payload.endpoint,
            }),
          },
        );
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(apiErrorMessage(data, "Turn alerts could not be disabled."));
        }
      }
      setTurnAlertsEnabled(false);
      setTurnAlertsMessage("Turn alerts are off for this game on this device.");
    } catch (error) {
      setTurnAlertsMessage(
        error instanceof Error
          ? error.message
          : "Turn alerts could not be disabled.",
      );
    } finally {
      setTurnAlertsBusy(false);
    }
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

          {activeGameId ? (
            <section className={styles.section} aria-labelledby="turn-alert-settings-title">
              <h3 id="turn-alert-settings-title">Turn alerts</h3>
              <p>
                Get a notification when an opponent hands you the turn, even
                after ChessRiot is closed. Alerts are off until you enable them.
              </p>
              {pushReady && !turnAlertsAvailable ? (
                <p className={styles.note}>Turn alerts are available in multiplayer games.</p>
              ) : pushReady && !pushPublicKey ? (
                <p className={styles.note}>Closed-app alerts are unavailable in this browser.</p>
              ) : (
                <button
                  className={styles.action}
                  type="button"
                  data-enabled={turnAlertsEnabled}
                  disabled={!pushReady || turnAlertsBusy}
                  onClick={() => void (
                    turnAlertsEnabled
                      ? disableTurnAlerts()
                      : enableTurnAlerts()
                  )}
                >
                  {turnAlertsBusy
                    ? "SAVING…"
                    : turnAlertsEnabled ? "TURN ALERTS ON" : "ENABLE TURN ALERTS"}
                </button>
              )}
              {turnAlertsMessage ? (
                <p className={styles.note} role="status">{turnAlertsMessage}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
