"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, requestHeaders } from "@/lib/client-http";
import {
  readChessCoachPreference,
  readTacticalCelebrationsPreference,
  writeChessCoachPreference,
  writeTacticalCelebrationsPreference,
} from "@/lib/chess-coach";
import {
  generateUuid,
  playerKey,
  readSeatTokenFromHash,
} from "@/lib/client-storage";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/external-links";
import {
  AUDIO_PREFERENCES_EVENT,
  playGameSound,
  readMasterVolume,
  readMusicPreference,
  readSoundPreference,
  unlockGameSounds,
  writeMasterVolume,
  writeMusicPreference,
  writeSoundPreference,
  type AudioPreferences,
} from "@/lib/game-sounds";
import {
  readMoveConfirmationPreference,
  writeMoveConfirmationPreference,
} from "@/lib/move-confirmation";
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
import {
  DEFAULT_THEME,
  isThemeId,
  THEMES,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "@/lib/themes";
import { APP_VERSION } from "@/lib/version";
import { FeedbackForm } from "./FeedbackButton";
import { ChessPiece } from "./ChessPiece";
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

interface GameMenuState {
  status: "waiting" | "active" | "completed";
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
  const [appearanceOpen, setAppearanceOpen] = useState(false);
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
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [gameMenuState, setGameMenuState] = useState<GameMenuState | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [masterVolume, setMasterVolume] = useState(.45);
  const [chessCoachOn, setChessCoachOn] = useState(true);
  const [tacticalCelebrationsOn, setTacticalCelebrationsOn] = useState(true);
  const [confirmEveryMove, setConfirmEveryMove] = useState(false);

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
    const currentTheme = document.documentElement.dataset.theme;
    if (isThemeId(currentTheme)) setSelectedTheme(currentTheme);
    const syncPreferences = (publish = false) => {
      const preferences = {
        effectsOn: readSoundPreference(),
        musicOn: readMusicPreference(),
        masterVolume: readMasterVolume(),
      };
      setSoundOn(preferences.effectsOn);
      setMusicOn(preferences.musicOn);
      setMasterVolume(preferences.masterVolume);
      setChessCoachOn(readChessCoachPreference());
      setTacticalCelebrationsOn(readTacticalCelebrationsPreference());
      setConfirmEveryMove(readMoveConfirmationPreference());
      if (publish) {
        window.dispatchEvent(new CustomEvent<AudioPreferences>(
          AUDIO_PREFERENCES_EVENT,
          { detail: preferences },
        ));
      }
    };
    syncPreferences();

    const syncTheme = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemeId(event.newValue)) {
        document.documentElement.dataset.theme = event.newValue;
        setSelectedTheme(event.newValue);
        window.dispatchEvent(new CustomEvent("chessriot:theme-changed", { detail: event.newValue }));
      }
      syncPreferences(true);
    };
    const syncGameMenu = (event: Event) => {
      const detail = (event as CustomEvent<GameMenuState | null>).detail;
      setGameMenuState(detail);
    };
    window.addEventListener("storage", syncTheme);
    window.addEventListener("chessriot:game-menu-state", syncGameMenu);
    return () => {
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener("chessriot:game-menu-state", syncGameMenu);
    };
  }, []);

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

  function chooseTheme(theme: ThemeId) {
    document.documentElement.dataset.theme = theme;
    setSelectedTheme(theme);
    storeValue(THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent("chessriot:theme-changed", { detail: theme }));
  }

  function publishAudio(preferences: AudioPreferences) {
    window.dispatchEvent(new CustomEvent(AUDIO_PREFERENCES_EVENT, { detail: preferences }));
  }

  function changeMasterVolume(volume: number) {
    const next = Math.max(0, Math.min(1, volume));
    setMasterVolume(next);
    writeMasterVolume(next);
    publishAudio({ effectsOn: soundOn, musicOn, masterVolume: next });
  }

  function toggleSoundEffects() {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPreference(next);
    publishAudio({ effectsOn: next, musicOn, masterVolume });
    if (next) void unlockGameSounds().then((unlocked) => {
      if (unlocked) playGameSound("move");
    });
  }

  function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);
    writeMusicPreference(next);
    if (next) void unlockGameSounds();
    publishAudio({ effectsOn: soundOn, musicOn: next, masterVolume });
  }

  function toggleCoach() {
    const next = !chessCoachOn;
    setChessCoachOn(next);
    writeChessCoachPreference(next);
    window.dispatchEvent(new CustomEvent("chessriot:coach-preference", { detail: next }));
  }

  function toggleCelebrations() {
    const next = !tacticalCelebrationsOn;
    setTacticalCelebrationsOn(next);
    writeTacticalCelebrationsPreference(next);
    window.dispatchEvent(new CustomEvent("chessriot:celebrations-preference", { detail: next }));
  }

  function toggleMoveConfirmation() {
    const next = !confirmEveryMove;
    setConfirmEveryMove(next);
    writeMoveConfirmationPreference(next);
    window.dispatchEvent(new CustomEvent("chessriot:move-confirmation-preference", { detail: next }));
  }

  function requestSurrender() {
    closeDialog();
    window.dispatchEvent(new CustomEvent("chessriot:surrender"));
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
          ? "Open ChessRiot menu, new release available"
          : "Open ChessRiot menu"}
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        title="Settings"
        onClick={openDialog}
      >
        <span aria-hidden="true">⚙</span>
        {releaseDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      </button>
      <dialog
        className={styles.dialog}
        ref={dialogRef}
        aria-labelledby="app-menu-title"
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
              <p>CHESSRIOT</p>
              <h2 id="app-menu-title">Settings</h2>
            </div>
            <button className={styles.close} type="button" onClick={closeDialog} aria-label="Close">×</button>
          </div>

          <nav className={styles.quickLinks} aria-label="ChessRiot menu">
            <Link href="/app" onClick={closeDialog}>NEW GAME</Link>
            <Link href="/changelog" onClick={closeDialog}>WHAT&apos;S NEW</Link>
          </nav>

          <details
            className={styles.group}
            open={appearanceOpen}
            onToggle={(event) => setAppearanceOpen(event.currentTarget.open)}
          >
            <summary>Appearance and skin</summary>
            <div className={styles.groupBody}>
              <p>Changes the whole app, including setup, menus, board, pieces, music, and effects.</p>
              {dialogOpen && appearanceOpen ? <fieldset className={styles.skinGrid}>
              <legend className="visually-hidden">ChessRiot skin</legend>
              {THEMES.map((theme) => (
                <label data-selected={selectedTheme === theme.id} key={theme.id}>
                  <input
                    type="radio"
                    name="menu-theme"
                    value={theme.id}
                    checked={selectedTheme === theme.id}
                    onChange={() => chooseTheme(theme.id)}
                  />
                  <span style={{
                    backgroundImage: theme.art
                      ? `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url(${theme.art})`
                      : `linear-gradient(135deg,${theme.preview[0]} 0 50%,${theme.preview[1]} 50%)`,
                    "--preview-light": theme.preview[0],
                    "--preview-dark": theme.preview[2],
                    "--preview-accent": theme.preview[3],
                  } as CSSProperties}>
                    <ChessPiece type="n" color="w" theme={theme.id} />
                    <ChessPiece type="q" color="b" theme={theme.id} />
                  </span>
                  <b>{theme.name}</b>
                </label>
              ))}
              </fieldset> : null}
            </div>
          </details>

          <details className={styles.group}>
            <summary>Sound, music and volume</summary>
            <div className={styles.groupBody}>
              <button className={styles.action} type="button" data-enabled={soundOn} aria-pressed={soundOn} onClick={toggleSoundEffects}>
                SOUND EFFECTS {soundOn ? "ON" : "OFF"}
              </button>
              <button className={styles.action} type="button" data-enabled={musicOn} aria-pressed={musicOn} onClick={toggleMusic}>
                MUSIC {musicOn ? "ON" : "OFF"}
              </button>
              <label className={styles.volumeControl}>
                <span>MASTER VOLUME</span>
                <output>{Math.round(masterVolume * 100)}%</output>
                <input type="range" min="0" max="1" step="0.05" value={masterVolume}
                  onChange={(event) => changeMasterVolume(Number(event.currentTarget.value))} />
              </label>
            </div>
          </details>

          <details className={styles.group}>
            <summary>Play assistance</summary>
            <div className={styles.groupBody}>
              <button className={styles.action} type="button" data-enabled={chessCoachOn} aria-pressed={chessCoachOn} onClick={toggleCoach}>
                CHESS COACH {chessCoachOn ? "ON" : "OFF"}
              </button>
              <button className={styles.action} type="button" data-enabled={tacticalCelebrationsOn} aria-pressed={tacticalCelebrationsOn} onClick={toggleCelebrations}>
                GREAT-MOVE CELEBRATIONS {tacticalCelebrationsOn ? "ON" : "OFF"}
              </button>
              <button className={styles.action} type="button" data-enabled={confirmEveryMove} aria-pressed={confirmEveryMove} onClick={toggleMoveConfirmation}>
                CONFIRM EVERY MOVE {confirmEveryMove ? "ON" : "OFF"}
              </button>
            </div>
          </details>

          {activeGameId ? (
            <section className={styles.section} aria-labelledby="game-settings-title">
              <h3 id="game-settings-title">Current game</h3>
              <h4>Turn alerts</h4>
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
                  aria-pressed={turnAlertsEnabled}
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
              {gameMenuState && gameMenuState.status !== "completed" ? (
                <button
                  className={`${styles.action} ${styles.danger}`}
                  type="button"
                  onClick={requestSurrender}
                >
                  {gameMenuState?.status === "waiting" ? "CANCEL GAME" : "SURRENDER"}
                </button>
              ) : null}
            </section>
          ) : null}

          <details className={styles.group}>
            <summary>Send feedback</summary>
            <div className={styles.groupBody}><FeedbackForm /></div>
          </details>

          <details className={styles.group}>
            <summary>App, updates and community</summary>
            <div className={styles.groupBody}>
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
              {!installed && installPrompt ? (
                <button className={styles.action} type="button" onClick={() => void installApp()}>
                  INSTALL CHESSRIOT
                </button>
              ) : null}
              <a
                className={styles.communityAction}
                href={WHATSAPP_COMMUNITY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                JOIN WHATSAPP COMMUNITY
              </a>
              <Link className={styles.communityAction} href="/privacy" onClick={closeDialog}>
                PRIVACY
              </Link>
            </div>
          </details>
        </div>
      </dialog>
    </>
  );
}
