"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  AUTH_SESSION_CHANGED_EVENT,
  AUTH_SESSION_INVALIDATED_EVENT,
  publishAuthSessionChanged,
} from "@/lib/auth-session-client";
import { apiErrorMessage, requestHeaders } from "@/lib/client-http";
import {
  readChessCoachPreference,
  readTacticalCelebrationsPreference,
  writeChessCoachPreference,
  writeTacticalCelebrationsPreference,
} from "@/lib/chess-coach";
import { generateUuid } from "@/lib/client-storage";
import { fetchJsonWithReadTimeout, fetchWithReadTimeout } from "@/lib/client-recovery";
import { reportClientEvent } from "@/lib/client-telemetry";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/external-links";
import {
  AUDIO_PREFERENCES_EVENT,
  playGameSound,
  readEffectsVolume,
  readMasterVolume,
  readMusicVolume,
  readMusicPreference,
  readSoundPreference,
  unlockGameSounds,
  writeEffectsVolume,
  writeMusicVolume,
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
  accountNotificationTogglePresentation,
  hasUnseenRelease,
  mayClearTurnNotification,
  notificationOfferDecisionKey,
  PUSH_DEVICE_OWNER_KEY,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASE_SEEN_KEY,
  releaseTarget,
  shouldBadgeAccountNotificationSettings,
} from "@/lib/pwa";
import {
  notificationDecisionKeepsPushSubscription,
  pushSubscriptionNeedsReplacement,
  recoverNotificationDecision,
  resumableNotificationDecision,
  shouldRepairPushSubscription,
} from "@/lib/notification-permission";
import {
  browserPushPayload,
  pushEndpointHash,
  setPushConsentEnabled,
  subscriptionUsesApplicationServerKey,
} from "@/lib/push-client";
import {
  createPushDiagnosticReceiptWaiter,
  ensureCurrentPushDiagnosticWorker,
  pushPresentationRecoveryMessage,
  registerLocalPushDiagnostic,
} from "@/lib/push-diagnostics";
import { registerPushDevice, unregisterPushDevice } from "@/lib/push-registration-client";
import {
  PushSetupError,
  pushSetupHttpError,
  pushSetupRecoveryMessage,
  pushSetupTelemetryCode,
  runPushSetupStage,
} from "@/lib/push-setup";
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
  owned?: unknown;
  legacy?: unknown;
  stale?: unknown;
}

interface AuthSessionPayload {
  available?: unknown;
  signedIn?: unknown;
  account?: { displayName?: unknown; username?: unknown } | null;
}

interface GameMenuState {
  status: "waiting" | "active" | "completed";
  mode: "solo" | "multiplayer";
}

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;
const PUSH_OPERATION_TIMEOUT_MS = 12_000;
const SIGN_OUT_PUSH_DISCOVERY_TIMEOUT_MS = 750;

async function withPushOperationTimeout<T>(
  operation: Promise<T>,
  message = "Notification setup timed out.",
  timeoutMs = PUSH_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          const error = new Error(message);
          error.name = "TimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function unsupportedPushMessage(braveBrowser: boolean): string {
  return braveBrowser
    ? "הודעות Push כבויות. ב־Brave הפעילו Use Google Services for Push Messaging ואז פתחו שוב את ChessRiot."
    : "הדפדפן הזה אינו תומך בהתראות ChessRiot. השתמשו בגרסה עדכנית של Chrome, Edge, Firefox או Safari.";
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

function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Privacy cleanup still proceeds at the browser subscription layer.
  }
}

function applyDocumentTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

export function AppUpdates() {
  const pathname = usePathname();
  const activeGameId = gameIdFromPathname(pathname);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const notificationSettingsRef = useRef<HTMLElement>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const pushDiagnosticAbortRef = useRef<AbortController | null>(null);
  const previousGoogleUsernameRef = useRef<string | null>(null);
  const pushOwnerGenerationRef = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [releaseDot, setReleaseDot] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [turnAlertsSupported, setTurnAlertsSupported] = useState(true);
  const [turnAlertsAvailable, setTurnAlertsAvailable] = useState(true);
  const [turnAlertsEnabled, setTurnAlertsEnabled] = useState(false);
  const [legacyTurnAlertsEnabled, setLegacyTurnAlertsEnabled] = useState(false);
  const [turnAlertsStatusKnown, setTurnAlertsStatusKnown] = useState(false);
  const [turnAlertsBusy, setTurnAlertsBusy] = useState(false);
  const [turnAlertsMessage, setTurnAlertsMessage] = useState("");
  const [turnAlertsMessageIsError, setTurnAlertsMessageIsError] = useState(false);
  const [turnAlertsRefresh, setTurnAlertsRefresh] = useState(0);
  const [notificationOfferDecision, setNotificationOfferDecision] = useState<string | null>(null);
  const [mobileNotificationSurface, setMobileNotificationSurface] = useState(false);
  const [braveBrowser, setBraveBrowser] = useState(false);
  const [windowsPlatform, setWindowsPlatform] = useState(false);
  const [androidPlatform, setAndroidPlatform] = useState(false);
  const [notificationHostname, setNotificationHostname] = useState("ChessRiot");
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [gameMenuState, setGameMenuState] = useState<GameMenuState | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [effectsVolume, setEffectsVolume] = useState(.45);
  const [musicVolume, setMusicVolume] = useState(.45);
  const [chessCoachOn, setChessCoachOn] = useState(true);
  const [tacticalCelebrationsOn, setTacticalCelebrationsOn] = useState(true);
  const [confirmEveryMove, setConfirmEveryMove] = useState(false);
  const [googleAuthReady, setGoogleAuthReady] = useState(false);
  const [googleSessionState, setGoogleSessionState] = useState<
    "loading" | "signed_in" | "signed_out" | "error"
  >("loading");
  const [pushOwnerReady, setPushOwnerReady] = useState(false);
  const [googleAuthAvailable, setGoogleAuthAvailable] = useState(false);
  const [googleAccountName, setGoogleAccountName] = useState<string | null>(null);
  const [googleUsername, setGoogleUsername] = useState<string | null>(null);
  const googleUsernameRef = useRef<string | null>(googleUsername);
  const [googleAuthBusy, setGoogleAuthBusy] = useState(false);
  const [googleAuthMessage, setGoogleAuthMessage] = useState("");
  const [googleAuthMessageIsError, setGoogleAuthMessageIsError] = useState(false);

  const getServiceWorkerRegistration = useCallback(async () => {
    if (serviceWorkerRef.current) return serviceWorkerRef.current;
    const registration = await withPushOperationTimeout(navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }), "The service worker did not register.");
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

  const refreshGoogleSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("לא הצלחנו לטעון את מצב החשבון.");
      const data = await response.json() as AuthSessionPayload;
      const name = data.signedIn === true
        && data.account
        && typeof data.account.displayName === "string"
        ? data.account.displayName
        : null;
      const username = data.signedIn === true
        && data.account
        && typeof data.account.username === "string"
        ? data.account.username
        : null;
      setGoogleAuthAvailable(data.available === true);
      setGoogleAccountName(name);
      googleUsernameRef.current = username;
      setGoogleUsername(username);
      setGoogleSessionState(data.signedIn === true ? "signed_in" : "signed_out");
    } catch {
      setGoogleAuthAvailable(false);
      setGoogleAccountName(null);
      googleUsernameRef.current = null;
      setGoogleUsername(null);
      setGoogleSessionState("error");
    } finally {
      setGoogleAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshGoogleSession();
    const refresh = () => void refreshGoogleSession();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refresh);
    window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, refresh);
    };
  }, [refreshGoogleSession]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("auth") !== "google_failed") return;

    setGoogleAuthMessage("הכניסה עם Google לא הושלמה. נסו שוב.");
    setGoogleAuthMessageIsError(true);
    setDialogOpen(true);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    void refreshGoogleSession();

    url.searchParams.delete("auth");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [refreshGoogleSession]);

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
        effectsVolume: readEffectsVolume(),
        musicVolume: readMusicVolume(),
      };
      setSoundOn(preferences.effectsOn);
      setMusicOn(preferences.musicOn);
      setEffectsVolume(preferences.effectsVolume);
      setMusicVolume(preferences.musicVolume);
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
    setWindowsPlatform(/Windows/i.test(navigator.userAgent));
    setAndroidPlatform(/Android/i.test(navigator.userAgent));
    setNotificationHostname(window.location.hostname || "ChessRiot");
    const browser = navigator as Navigator & {
      brave?: { isBrave?: () => Promise<boolean> };
    };
    let cancelled = false;
    void Promise.resolve(browser.brave?.isBrave?.() ?? false)
      .then((isBrave) => {
        if (!cancelled) setBraveBrowser(isBrave === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px) and (pointer: coarse)");
    const sync = () => setMobileNotificationSurface(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    googleUsernameRef.current = googleUsername;
    pushDiagnosticAbortRef.current?.abort();
    pushDiagnosticAbortRef.current = null;
    setTurnAlertsBusy(false);
  }, [googleUsername]);

  useEffect(() => {
    setTurnAlertsMessage("");
    setTurnAlertsMessageIsError(false);
    setPushReady(false);
    setPushPublicKey(null);
    setNotificationOfferDecision(googleUsername
      ? storedValue(notificationOfferDecisionKey(googleUsername))
      : null);
    setTurnAlertsAvailable(true);
    setTurnAlertsEnabled(false);
    setLegacyTurnAlertsEnabled(false);
    setTurnAlertsStatusKnown(false);
  }, [googleUsername]);

  useEffect(() => {
    if (!activeGameId) return;
    const reconcile = (event: Event) => {
      const detail = (event as CustomEvent<{ gameId?: unknown; version?: unknown }>).detail;
      if (
        detail?.gameId !== activeGameId
        || !Number.isSafeInteger(detail.version)
        || Number(detail.version) < 0
        || !mayClearTurnNotification(document.visibilityState, document.hasFocus())
      ) return;
      if (!("serviceWorker" in navigator)) return;
      void getServiceWorkerRegistration()
        .then((registration) => {
          const worker = registration.active ?? navigator.serviceWorker.controller;
          worker?.postMessage({
            type: "clear-turn-notification",
            gameId: activeGameId,
            gameVersion: detail.version,
          });
        })
        .catch(() => undefined);
    };
    window.addEventListener("chessriot:authoritative-game-visible", reconcile);
    return () => {
      window.removeEventListener("chessriot:authoritative-game-visible", reconcile);
    };
  }, [activeGameId, getServiceWorkerRegistration]);

  useEffect(() => {
    const generation = pushOwnerGenerationRef.current + 1;
    pushOwnerGenerationRef.current = generation;
    if (!googleAuthReady || googleSessionState === "loading" || googleSessionState === "error") {
      setPushOwnerReady(false);
      return;
    }
    let cancelled = false;
    const username = googleUsername;
    const isCurrent = () => !cancelled
      && pushOwnerGenerationRef.current === generation
      && googleUsernameRef.current === username;
    setPushOwnerReady(false);
    const storedOwner = storedValue(PUSH_DEVICE_OWNER_KEY);
    const previousOwner = previousGoogleUsernameRef.current;
    const accountChanged = Boolean(
      googleUsername
      && (
        (storedOwner && storedOwner !== googleUsername)
        || (previousOwner && previousOwner !== googleUsername)
      ),
    );
    const mustDetach = googleSessionState === "signed_out" || accountChanged;
    void (async () => {
      if (mustDetach && "serviceWorker" in navigator) {
        void setPushConsentEnabled(false);
        if (!isCurrent()) return;
        const registration = await withPushOperationTimeout(
          navigator.serviceWorker.getRegistration("/"),
        ).catch(() => undefined);
        if (!isCurrent()) return;
        if (registration) {
          try {
            const subscription = await withPushOperationTimeout(
              registration.pushManager.getSubscription(),
            );
            if (!isCurrent()) return;
            if (subscription) {
              const removed = await withPushOperationTimeout(subscription.unsubscribe());
              if (!removed) throw new Error("The previous notification owner could not be detached.");
            }
          } catch {
            if (!isCurrent()) return;
            await withPushOperationTimeout(registration.unregister()).catch(() => false);
            if (!isCurrent()) return;
            serviceWorkerRef.current = null;
          }
        }
        if (!isCurrent()) return;
        removeStoredValue(PUSH_DEVICE_OWNER_KEY);
      }
      if (!isCurrent()) return;
      previousGoogleUsernameRef.current = username;
      setPushOwnerReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [googleAuthReady, googleSessionState, googleUsername]);

  useEffect(() => {
    setPushReady(false);
    if (!googleUsername || !pushOwnerReady || turnAlertsBusy) return;
    const username = googleUsername;
    const browserSupported = (
      !("serviceWorker" in navigator)
      || !("PushManager" in window)
      || !("Notification" in window)
      || typeof ServiceWorkerRegistration === "undefined"
      || !("showNotification" in ServiceWorkerRegistration.prototype)
    ) === false;
    setTurnAlertsSupported(browserSupported);
    const decisionKey = notificationOfferDecisionKey(username);
    if (browserSupported) {
      const initialDecision = storedValue(decisionKey);
      const resumedDecision = resumableNotificationDecision(
        Notification.permission,
        initialDecision,
      );
      if (resumedDecision !== initialDecision && resumedDecision) {
        storeValue(decisionKey, resumedDecision);
        setNotificationOfferDecision(resumedDecision);
      }
    }
    let cancelled = false;
    const controller = new AbortController();
    const isCurrent = () => !cancelled && googleUsernameRef.current === username;
    const markPendingSetupFailed = (message: string, code: string): boolean => {
      if (!isCurrent()) return false;
      const decision = storedValue(decisionKey);
      if (decision !== "setup-pending") return false;
      storeValue(notificationOfferDecisionKey(username), "setup-failed");
      setNotificationOfferDecision("setup-failed");
      setTurnAlertsMessageIsError(true);
      setTurnAlertsMessage(message);
      reportClientEvent("client.error", code);
      return true;
    };
    const markPushStatusUnknown = (message: string) => {
      if (!isCurrent()) return;
      setTurnAlertsStatusKnown(false);
      setTurnAlertsMessageIsError(true);
      setTurnAlertsMessage(message);
      setPushReady(true);
    };
    const detachSubscription = async (
      current: PushSubscription,
      options: { preserveLegacy: boolean; keepBrowser: boolean },
    ): Promise<boolean> => {
      const payload = browserPushPayload(current);
      let serverDetached = false;
      try {
        if (payload) {
          const response = await fetchWithReadTimeout("/api/me/push-devices", {
            method: "DELETE",
            credentials: "same-origin",
            headers: requestHeaders(null, true),
            signal: controller.signal,
            body: JSON.stringify({
              requestId: generateUuid(),
              endpoint: payload.endpoint,
              expectedUsername: username,
              preserveLegacy: options.preserveLegacy,
            }),
          });
          serverDetached = response.ok;
          if (response.ok) response.body?.cancel();
        }
      } catch {
        serverDetached = false;
      }
      if (!options.keepBrowser) {
        await withPushOperationTimeout(current.unsubscribe()).catch(() => false);
      }
      return serverDetached;
    };
    const repairSubscription = async (
      registration: ServiceWorkerRegistration,
      publicKey: string,
    ): Promise<PushSubscription | null> => {
      const repaired = await runPushSetupStage(
        "subscription_create",
        () => withPushOperationTimeout(registerPushDevice({
          registration,
          publicKey,
          expectedUsername: username,
        })),
      );
      if (isCurrent()) return repaired;
      if (googleUsernameRef.current !== username) {
        await unregisterPushDevice({
          subscription: repaired,
          expectedUsername: username,
        }).catch(() => undefined);
      }
      return null;
    };

    void (async () => {
      try {
        const configResponse = await runPushSetupStage(
          "config",
          () => fetchWithReadTimeout("/api/push/config", {
            cache: "no-store",
            signal: controller.signal,
          }),
        );
        if (!configResponse.ok) throw pushSetupHttpError("config", configResponse.status);
        const config = await runPushSetupStage(
          "config",
          () => withPushOperationTimeout(
            configResponse.json() as Promise<PushConfigPayload>,
          ),
        );
        if (!isCurrent()) return;
        if (config?.enabled !== true || typeof config.publicKey !== "string") {
          markPendingSetupFailed(
            "ההתראות אינן מוגדרות כרגע. נסו שוב מאוחר יותר דרך ההגדרות.",
            "push_reconcile_config_unavailable",
          );
          setTurnAlertsAvailable(false);
          setTurnAlertsStatusKnown(true);
          setPushReady(true);
          return;
        }
        const publicKey = config.publicKey;
        setPushPublicKey(publicKey);
        setTurnAlertsAvailable(true);
        if (!browserSupported) {
          setTurnAlertsStatusKnown(true);
          setPushReady(true);
          return;
        }

        const registration = await runPushSetupStage(
          "service_worker",
          getServiceWorkerRegistration,
        );
        if (!isCurrent()) return;
        const permissionGranted = Notification.permission === "granted";
        let storedDecision = storedValue(decisionKey);
        let keepSubscription = notificationDecisionKeepsPushSubscription(storedDecision);
        let subscription = await runPushSetupStage(
          "subscription_read",
          () => withPushOperationTimeout(registration.pushManager.getSubscription()),
        );
        if (!isCurrent()) return;

        if (subscription && pushSubscriptionNeedsReplacement({
          expirationTime: subscription.expirationTime,
          serverStale: false,
        })) {
          const removed = await runPushSetupStage(
            "subscription_replace",
            () => withPushOperationTimeout(subscription!.unsubscribe()),
          );
          if (!removed) throw new PushSetupError("subscription_replace", "invalid_state");
          subscription = null;
        }

        if (subscription && !subscriptionUsesApplicationServerKey(subscription, publicKey)) {
          const detached = await detachSubscription(subscription, {
            preserveLegacy: false,
            keepBrowser: false,
          });
          if (!detached) {
            throw new PushSetupError("subscription_replace", "invalid_state");
          }
          subscription = null;
        }
        if (!permissionGranted) {
          if (subscription) {
            await detachSubscription(subscription, { preserveLegacy: false, keepBrowser: false });
          }
          if (!isCurrent()) return;
          await setPushConsentEnabled(false);
          if (!isCurrent()) return;
          removeStoredValue(PUSH_DEVICE_OWNER_KEY);
          if (storedDecision === "setup-pending") {
            markPendingSetupFailed(
              "ההתראות לא הופעלו. אפשר לנסות שוב מאוחר יותר דרך ההגדרות.",
              "push_reconcile_permission_missing",
            );
          }
          setTurnAlertsEnabled(false);
          setLegacyTurnAlertsEnabled(false);
          setTurnAlertsStatusKnown(true);
          setPushReady(true);
          return;
        }

        if (shouldRepairPushSubscription({
          permission: Notification.permission,
          accountDecision: storedDecision,
          hasSubscription: Boolean(subscription),
        })) {
          const repaired = await repairSubscription(registration, publicKey);
          if (!repaired) return;
          subscription = repaired;
        }

        const subscriptionEndpoint = subscription?.endpoint ?? null;
        const endpointHash = subscriptionEndpoint
          ? await runPushSetupStage(
            "subscription_serialize",
            () => withPushOperationTimeout(pushEndpointHash(subscriptionEndpoint)),
          )
          : null;
        if (!isCurrent()) return;
        const headers: Record<string, string> = {};
        if (endpointHash) headers["x-push-endpoint-hash"] = endpointHash;
        const statusResponse = await runPushSetupStage(
          "server_status",
          () => fetchWithReadTimeout("/api/me/push-devices", {
            cache: "no-store",
            credentials: "same-origin",
            headers,
            signal: controller.signal,
          }),
        );
        if (!statusResponse.ok) throw pushSetupHttpError("server_status", statusResponse.status);
        const status = await runPushSetupStage(
          "server_status",
          () => withPushOperationTimeout(
            statusResponse.json() as Promise<PushStatusPayload>,
          ),
        );
        if (!isCurrent()) return;
        let enabled = status.enabled === true;
        let legacyEnabled = status.legacy === true && Boolean(subscription);
        // Another tab can change the choice while the status request is in flight.
        storedDecision = storedValue(decisionKey);
        keepSubscription = notificationDecisionKeepsPushSubscription(storedDecision);

        const recoveredDecision = recoverNotificationDecision({
          permission: Notification.permission,
          accountDecision: storedDecision,
          serverEnabled: enabled && Boolean(subscription),
        });
        if (recoveredDecision !== storedDecision && recoveredDecision) {
          storeValue(decisionKey, recoveredDecision);
          setNotificationOfferDecision(recoveredDecision);
          keepSubscription = notificationDecisionKeepsPushSubscription(recoveredDecision);
        }

        if (subscription && keepSubscription && pushSubscriptionNeedsReplacement({
          expirationTime: subscription.expirationTime,
          serverStale: status.stale === true,
        })) {
          const removed = await runPushSetupStage(
            "subscription_replace",
            () => withPushOperationTimeout(subscription!.unsubscribe()),
          );
          if (!removed) throw new PushSetupError("subscription_replace", "invalid_state");
          const repaired = await repairSubscription(registration, publicKey);
          if (!repaired) return;
          subscription = repaired;
          enabled = true;
          legacyEnabled = false;
        }

        if (subscription && enabled && !keepSubscription) {
          const narrowed = await detachSubscription(subscription, {
            preserveLegacy: true,
            keepBrowser: legacyEnabled,
          });
          if (!isCurrent()) return;
          if (!narrowed && legacyEnabled) {
            setTurnAlertsEnabled(true);
            setLegacyTurnAlertsEnabled(false);
            setTurnAlertsStatusKnown(true);
            setTurnAlertsMessageIsError(true);
            setTurnAlertsMessage("עדיין לא הצלחנו לכבות את ההתראות. נסו שוב דרך ההגדרות.");
            setPushReady(true);
            return;
          }
          enabled = false;
          if (!legacyEnabled || !narrowed) subscription = null;
        }
        if (subscription && status.owned === false && !keepSubscription) {
          await withPushOperationTimeout(subscription.unsubscribe()).catch(() => false);
          subscription = null;
          legacyEnabled = false;
        }
        if (!enabled && subscription && keepSubscription) {
          const payload = browserPushPayload(subscription);
          if (!payload) {
            throw new PushSetupError("subscription_serialize", "invalid_response");
          }
          const repair = await runPushSetupStage(
            "server_register",
            () => fetchWithReadTimeout("/api/me/push-devices", {
              method: "PUT",
              credentials: "same-origin",
              headers: requestHeaders(null, true),
              signal: controller.signal,
              body: JSON.stringify({
                requestId: generateUuid(),
                expectedUsername: username,
                subscription: payload,
              }),
            }),
          );
          if (!repair.ok) throw pushSetupHttpError("server_register", repair.status);
          repair.body?.cancel();
          enabled = true;
        }

        if (!isCurrent()) return;
        if (enabled) {
          await setPushConsentEnabled(true, username);
          if (!isCurrent()) return;
          storeValue(PUSH_DEVICE_OWNER_KEY, username);
          if (storedDecision === "setup-pending" || storedDecision === "setup-failed") {
            storeValue(notificationOfferDecisionKey(username), "enabled");
            setNotificationOfferDecision("enabled");
            setTurnAlertsMessageIsError(false);
            setTurnAlertsMessage("ההתראות פעילות במכשיר הזה.");
          }
          legacyEnabled = false;
        } else {
          await setPushConsentEnabled(false);
          if (!isCurrent()) return;
          removeStoredValue(PUSH_DEVICE_OWNER_KEY);
          if (storedDecision === "setup-pending") {
            markPendingSetupFailed(
              "ההתראות מורשות, אבל המכשיר לא נשמר. נסו שוב דרך ההגדרות.",
              "push_reconcile_server_status_disabled",
            );
          }
        }
        if (!isCurrent()) return;
        setTurnAlertsEnabled(enabled);
        setLegacyTurnAlertsEnabled(!enabled && legacyEnabled);
        setTurnAlertsStatusKnown(true);
        setPushReady(true);
      } catch (error) {
        if (!isCurrent()) return;
        const pendingFailed = markPendingSetupFailed(
          pushSetupRecoveryMessage(error, braveBrowser, "he"),
          pushSetupTelemetryCode("reconcile", error),
        );
        if (!pendingFailed) {
          markPushStatusUnknown("לא הצלחנו לאמת את מצב ההתראות. נסו שוב לפני שינוי ההגדרה.");
        } else {
          setTurnAlertsStatusKnown(true);
          setTurnAlertsEnabled(false);
          setLegacyTurnAlertsEnabled(false);
          setPushReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [braveBrowser, getServiceWorkerRegistration, googleUsername, pushOwnerReady, turnAlertsBusy, turnAlertsRefresh]);

  useEffect(() => {
    if (!googleUsername) return;
    const refreshPushState = () => setTurnAlertsRefresh((value) => value + 1);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshPushState();
    };
    window.addEventListener("focus", refreshPushState);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshPushState);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [googleUsername]);

  function openDialog() {
    const target = releaseTarget(APP_VERSION, availableVersion);
    storeValue(RELEASE_SEEN_KEY, target);
    setReleaseDot(false);
    setDialogOpen(true);
    dialogRef.current?.showModal();
    if (showNotificationSettingsBadge) {
      window.requestAnimationFrame(() => {
        notificationSettingsRef.current?.scrollIntoView({ block: "start" });
      });
    }
    void refreshGoogleSession();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function recheckNotificationPermission() {
    const permission = typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission;
    setTurnAlertsMessageIsError(permission === "denied" || permission === "unsupported");
    setTurnAlertsMessage(permission === "denied"
      ? "ההתראות עדיין חסומות. ודאו ששתי ההרשאות מופעלות, חזרו ל־ChessRiot ולחצו שוב."
      : permission === "granted"
        ? "ההרשאה זוהתה. בודקים ומחזירים את ההתראות למכשיר הזה…"
        : permission === "default"
          ? "החסימה הוסרה. הפעילו את התראות ChessRiot כאן כדי להשלים את ההגדרה."
          : "הדפדפן הזה אינו תומך בהתראות ChessRiot.");
    setTurnAlertsRefresh((value) => value + 1);
  }

  function chooseTheme(theme: ThemeId) {
    applyDocumentTheme(theme);
    setSelectedTheme(theme);
    storeValue(THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent("chessriot:theme-changed", { detail: theme }));
  }

  function publishAudio(preferences: AudioPreferences) {
    window.dispatchEvent(new CustomEvent(AUDIO_PREFERENCES_EVENT, { detail: preferences }));
  }

  function changeEffectsVolume(volume: number) {
    const next = Math.max(0, Math.min(1, volume));
    setEffectsVolume(next);
    writeEffectsVolume(next);
    publishAudio({
      effectsOn: soundOn,
      musicOn,
      masterVolume: readMasterVolume(),
      effectsVolume: next,
      musicVolume,
    });
  }

  function changeMusicVolume(volume: number) {
    const next = Math.max(0, Math.min(1, volume));
    setMusicVolume(next);
    writeMusicVolume(next);
    publishAudio({
      effectsOn: soundOn,
      musicOn,
      masterVolume: readMasterVolume(),
      effectsVolume,
      musicVolume: next,
    });
  }

  function toggleSoundEffects() {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPreference(next);
    publishAudio({
      effectsOn: next,
      musicOn,
      masterVolume: readMasterVolume(),
      effectsVolume,
      musicVolume,
    });
    if (next) void unlockGameSounds().then((unlocked) => {
      if (unlocked) playGameSound("move");
    });
  }

  function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);
    writeMusicPreference(next);
    if (next) void unlockGameSounds();
    publishAudio({
      effectsOn: soundOn,
      musicOn: next,
      masterVolume: readMasterVolume(),
      effectsVolume,
      musicVolume,
    });
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

  function startGoogleLogin() {
    setGoogleAuthMessage("");
    setGoogleAuthMessageIsError(false);
    // A game fragment can contain a private seat capability. Never copy it
    // into an HTTP query or OAuth transaction cookie.
    const returnTo = `${pathname || "/app"}${window.location.search}`;
    window.location.assign(
      `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  async function signOutGoogle() {
    if (googleAuthBusy) return;
    setGoogleAuthBusy(true);
    setGoogleAuthMessage("");
    setGoogleAuthMessageIsError(false);
    try {
      void setPushConsentEnabled(false);
      const subscription = "serviceWorker" in navigator && "PushManager" in window
        ? await withPushOperationTimeout((async () => {
          const registration = await navigator.serviceWorker.getRegistration("/");
          return await registration?.pushManager.getSubscription() ?? null;
        })(), "Notification cleanup timed out.", SIGN_OUT_PUSH_DISCOVERY_TIMEOUT_MS)
          .catch(() => null)
        : null;
      const subscriptionPayload = subscription ? browserPushPayload(subscription) : null;
      const response = await fetchWithReadTimeout("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        headers: requestHeaders(null, true),
        body: JSON.stringify({ endpoint: subscriptionPayload?.endpoint ?? null }),
      });
      if (!response.ok) throw new Error("ההתנתקות לא הצליחה.");
      if (subscription) {
        void withPushOperationTimeout(
          subscription.unsubscribe(),
          "Notification cleanup timed out.",
          SIGN_OUT_PUSH_DISCOVERY_TIMEOUT_MS,
        ).catch(() => false);
      }
      removeStoredValue(PUSH_DEVICE_OWNER_KEY);
      setGoogleAccountName(null);
      googleUsernameRef.current = null;
      setGoogleUsername(null);
      publishAuthSessionChanged(false);
      window.location.assign(pathname === "/" ? "/" : "/app");
    } catch {
      setGoogleAuthMessage("לא הצלחנו להתנתק. נסו שוב.");
      setGoogleAuthMessageIsError(true);
    } finally {
      setGoogleAuthBusy(false);
    }
  }

  function startTutorial() {
    closeDialog();
    const event = new CustomEvent("chessriot:replay-tutorial", { cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) {
      window.location.assign("/app?tutorial=1");
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  async function enableTurnAlerts() {
    if (!googleUsername || !pushPublicKey || turnAlertsBusy) return;
    const username = googleUsername;
    const isCurrent = () => googleUsernameRef.current === username;
    setTurnAlertsBusy(true);
    setTurnAlertsMessage("");
    setTurnAlertsMessageIsError(false);
    try {
      setNotificationOfferDecision("setup-pending");
      storeValue(notificationOfferDecisionKey(username), "setup-pending");
      const registration = serviceWorkerRef.current ?? await runPushSetupStage(
        "service_worker",
        getServiceWorkerRegistration,
      );
      if (!isCurrent()) return;
      await registerPushDevice({
        registration,
        publicKey: pushPublicKey,
        expectedUsername: username,
      });
      if (!isCurrent()) return;
      setTurnAlertsEnabled(true);
      setLegacyTurnAlertsEnabled(false);
      setTurnAlertsStatusKnown(true);
      await setPushConsentEnabled(true, username);
      if (!isCurrent()) return;
      storeValue(PUSH_DEVICE_OWNER_KEY, username);
      setNotificationOfferDecision("enabled");
      storeValue(notificationOfferDecisionKey(username), "enabled");
      setTurnAlertsMessage("ההתראות פעילות במכשיר הזה.");
      if (!dialogOpen) window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (error) {
      if (!isCurrent()) return;
      await setPushConsentEnabled(false);
      if (!isCurrent()) return;
      setTurnAlertsEnabled(false);
      setLegacyTurnAlertsEnabled(false);
      setTurnAlertsStatusKnown(true);
      removeStoredValue(PUSH_DEVICE_OWNER_KEY);
      setNotificationOfferDecision("setup-failed");
      storeValue(notificationOfferDecisionKey(username), "setup-failed");
      reportClientEvent("client.error", pushSetupTelemetryCode("manual", error));
      setTurnAlertsMessageIsError(true);
      setTurnAlertsMessage(pushSetupRecoveryMessage(error, braveBrowser, "he"));
    } finally {
      setTurnAlertsBusy(false);
    }
  }

  async function disableTurnAlerts() {
    if (!googleUsername || turnAlertsBusy) return;
    const username = googleUsername;
    const isCurrent = () => googleUsernameRef.current === username;
    setTurnAlertsBusy(true);
    setTurnAlertsMessage("");
    setTurnAlertsMessageIsError(false);
    try {
      await setPushConsentEnabled(false);
      if (!isCurrent()) return;
      const registration = await getServiceWorkerRegistration();
      if (!isCurrent()) return;
      const subscription = await withPushOperationTimeout(registration.pushManager.getSubscription());
      if (!isCurrent()) return;
      if (subscription) {
        const payload = browserPushPayload(subscription);
        if (!payload) {
          throw new Error("הדפדפן החזיר הרשמה חלקית להתראות.");
        }
        const response = await fetchWithReadTimeout("/api/me/push-devices", {
          method: "DELETE",
          credentials: "same-origin",
          headers: requestHeaders(null, true),
          body: JSON.stringify({
            requestId: generateUuid(),
            endpoint: payload.endpoint,
            expectedUsername: username,
          }),
        });
        if (!response.ok) {
          const data: unknown = await withPushOperationTimeout(response.json()).catch(() => null);
          throw new Error(apiErrorMessage(data, "לא הצלחנו לכבות את ההתראות."));
        }
        response.body?.cancel();
        if (!isCurrent()) return;
        await withPushOperationTimeout(subscription.unsubscribe()).catch(() => false);
      }
      if (!isCurrent()) return;
      setTurnAlertsEnabled(false);
      setLegacyTurnAlertsEnabled(false);
      setTurnAlertsStatusKnown(true);
      removeStoredValue(PUSH_DEVICE_OWNER_KEY);
      setNotificationOfferDecision("disabled");
      storeValue(notificationOfferDecisionKey(username), "disabled");
      setTurnAlertsMessage("ההתראות כבויות במכשיר הזה.");
    } catch (error) {
      if (!isCurrent()) return;
      setTurnAlertsMessageIsError(true);
      setTurnAlertsMessage(
        error instanceof Error
          ? error.message
          : "לא הצלחנו לכבות את ההתראות.",
      );
    } finally {
      setTurnAlertsBusy(false);
    }
  }

  async function testTurnAlerts() {
    if (!googleUsername || turnAlertsBusy || !turnAlertsEnabled) return;
    const username = googleUsername;
    const isCurrent = () => googleUsernameRef.current === username;
    const controller = new AbortController();
    pushDiagnosticAbortRef.current?.abort();
    pushDiagnosticAbortRef.current = controller;
    setTurnAlertsBusy(true);
    setTurnAlertsMessage("");
    setTurnAlertsMessageIsError(false);
    let receiptWaiter: ReturnType<typeof createPushDiagnosticReceiptWaiter> | null = null;
    try {
      const registration = serviceWorkerRef.current ?? await getServiceWorkerRegistration();
      if (!isCurrent()) return;
      await ensureCurrentPushDiagnosticWorker(registration, { signal: controller.signal });
      if (!isCurrent()) return;
      const subscription = await registration.pushManager.getSubscription();
      if (!isCurrent()) return;
      const payload = subscription ? browserPushPayload(subscription) : null;
      if (!payload) {
        throw new Error("חיבור ההתראות של הדפדפן כבר אינו פעיל. כבו את ההתראות והפעילו אותן מחדש.");
      }
      const requestId = generateUuid();
      const localResult = await registerLocalPushDiagnostic(
        registration,
        requestId,
        navigator.serviceWorker,
        "he",
      );
      if (!isCurrent()) return;
      if (localResult === "missing") {
        throw new Error("הדפדפן קיבל את בקשת ההתראה המקומית אך לא שמר אותה. הפעילו מחדש את הדפדפן ונסו שוב.");
      }
      receiptWaiter = createPushDiagnosticReceiptWaiter(
        navigator.serviceWorker,
        requestId,
      );
      const { response, data: result } = await fetchJsonWithReadTimeout<unknown>("/api/me/push-devices/test", {
        method: "POST",
        credentials: "same-origin",
        headers: requestHeaders(null, true),
        signal: controller.signal,
        body: JSON.stringify({
          requestId,
          expectedUsername: username,
          endpoint: payload.endpoint,
        }),
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new Error(apiErrorMessage(result, "בדיקת ההתראה בשרת נכשלה."));
      }
      const outcome = result && typeof result === "object"
        ? (result as { outcome?: unknown }).outcome
        : null;
      if (outcome !== "accepted") {
        throw new Error(outcome === "provider_auth"
          ? "בדיקת התצוגה בדפדפן הצליחה, אך ספק ה־Push דחה את פרטי הגישה של ChessRiot."
          : outcome === "stale"
            ? "בדיקת התצוגה בדפדפן הצליחה, אך ספק ה־Push דיווח שחיבור ההתראות פג. הפעילו את ההתראות מחדש."
            : "בדיקת התצוגה בדפדפן הצליחה, אך ה־Push מהשרת לא התקבל. נסו שוב בעוד רגע.");
      }
      const receipt = await receiptWaiter.wait();
      receiptWaiter = null;
      if (!isCurrent()) return;
      if (receipt.cancelled) return;
      const stages = new Set(receipt.stages);
      const interacted = stages.has("notification_clicked");
      const notificationActive = stages.has("notification_active");
      const localEvidence = localResult === "active"
        ? "הדפדפן שמר את ההתראה המקומית."
        : localResult === "clicked"
          ? "ההתראה המקומית נפתחה."
          : "הדפדפן יצר את ההתראה המקומית, אך היא נסגרה לפני בדיקת השמירה.";
      if (!interacted && !notificationActive) {
        const browserName = braveBrowser ? "Brave" : "הדפדפן";
        const restart = braveBrowser
          ? "הפעילו מחדש את Brave, ודאו ששירותי Google להעברת הודעות Push פעילים ונסו שוב."
          : "הפעילו מחדש את הדפדפן ונסו שוב.";
        let detail = "שירות ה־Push קיבל את הבקשה, אך ChessRiot לא קיבל אישור מה־worker הפעיל בתוך 15 שניות.";
        if (stages.has("show_rejected")) {
          detail = `ה־worker הפעיל קיבל את הבקשה, אך ${browserName} דחה יצירת התראה קבועה.`;
        } else if (stages.has("notification_closed")) {
          detail = "ה־worker הפעיל יצר את התראת השרת, אך היא נסגרה לפני בדיקת השמירה. לכן לא ניתן לאשר שבאנר אכן הוצג.";
        } else if (stages.has("notification_missing")) {
          detail = `ה־worker הפעיל יצר את התראת השרת, אך ${browserName} לא שמר אותה.`;
        } else if (stages.has("show_resolved")) {
          detail = `ה־worker הפעיל קיבל את הבקשה ו־${browserName} אישר את קריאת ההתראה, אך ChessRiot לא הצליח לאמת שהיא נשמרה.`;
        } else if (stages.has("push_received")) {
          detail = `ה־worker הפעיל קיבל את הבקשה, אך ${browserName} לא סיים את קריאת ההתראה בתוך 15 שניות.`;
        }
        const recovery = stages.has("show_rejected")
          || stages.has("show_resolved")
          || stages.has("notification_closed")
          ? pushPresentationRecoveryMessage({
            brave: braveBrowser,
            mobile: mobileNotificationSurface,
            windows: windowsPlatform,
            locale: "he",
          })
          : restart;
        setTurnAlertsMessageIsError(true);
        setTurnAlertsMessage(
          `${localEvidence} ${detail} ${recovery}`,
        );
        return;
      }
      setTurnAlertsMessage([
        interacted
          ? `אומת: ${localEvidence} ה־worker הפעיל קיבל את ה־Push מהשרת, וההתראה נפתחה.`
          : `אומת: ${localEvidence} ה־worker הפעיל קיבל את ה־Push מהשרת ושמר את ההתראה.`,
        interacted
          ? ""
          : pushPresentationRecoveryMessage({
            brave: braveBrowser,
            mobile: mobileNotificationSurface,
            windows: windowsPlatform,
            locale: "he",
          }),
      ].filter(Boolean).join(" "));
    } catch (error) {
      if (!isCurrent()) return;
      setTurnAlertsMessageIsError(true);
      const detail = error instanceof Error ? error.message : "";
      setTurnAlertsMessage(/[\u0590-\u05ff]/.test(detail)
        ? detail
        : "בדיקת ההתראה נכשלה. טענו מחדש את ChessRiot ונסו שוב.");
    } finally {
      receiptWaiter?.cancel();
      if (pushDiagnosticAbortRef.current === controller) {
        pushDiagnosticAbortRef.current = null;
      }
      if (isCurrent()) setTurnAlertsBusy(false);
    }
  }

  const notificationToggle = accountNotificationTogglePresentation(
    turnAlertsEnabled,
    legacyTurnAlertsEnabled,
  );
  const notificationToggleDetail = turnAlertsEnabled
    ? "התראות החשבון פעילות במכשיר הזה"
    : legacyTurnAlertsEnabled
      ? "פעיל רק למשחקים ישנים"
      : "בקשות חברות, תורות והודעות שירות";
  const notificationToggleStatus = turnAlertsEnabled
    ? "פעיל"
    : legacyTurnAlertsEnabled
      ? "מוגבל"
      : "כבוי";
  const notificationPermission = typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
  const notificationRecoverySurface = mobileNotificationSurface || androidPlatform;
  const showNotificationSettingsBadge = shouldBadgeAccountNotificationSettings({
    activeGameId,
    mobile: notificationRecoverySurface,
    signedInUsername: googleUsername,
    pushReady: pushReady && turnAlertsStatusKnown,
    pushConfigured: Boolean(pushPublicKey),
    pushSupported: turnAlertsSupported,
    permission: notificationPermission,
    enabled: turnAlertsEnabled || legacyTurnAlertsEnabled,
    decision: notificationOfferDecision,
  });
  const showBlockedNotificationRecovery = Boolean(
    googleUsername
    && notificationRecoverySurface
    && notificationPermission === "denied"
    && showNotificationSettingsBadge,
  );

  return (
    <>
      <button
        className={styles.launcher}
        type="button"
        ref={triggerRef}
        lang="he"
        dir="rtl"
        translate="no"
        aria-label={showNotificationSettingsBadge
          ? "פתיחת הגדרות ChessRiot לטיפול בהתראות"
          : releaseDot
            ? "פתיחת תפריט ChessRiot, יש גרסה חדשה"
            : "פתיחת תפריט ChessRiot"}
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        title="הגדרות"
        data-turn-alert-offer={showNotificationSettingsBadge ? "true" : undefined}
        data-notification-blocked={showBlockedNotificationRecovery ? "true" : undefined}
        onClick={openDialog}
      >
        <span aria-hidden="true">⚙</span>
        {releaseDot ? <span className={styles.dot} aria-hidden="true" /> : null}
        {showNotificationSettingsBadge ? (
          <span className={styles.turnAlertBadge} aria-hidden="true">🔔</span>
        ) : null}
      </button>
      {showNotificationSettingsBadge ? (
        <aside
          className={styles.notificationRecoveryBanner}
          lang="he"
          dir="rtl"
          translate="no"
          role="alert"
          aria-labelledby="notification-recovery-title"
        >
          <span aria-hidden="true">🔔</span>
          <div>
            <strong id="notification-recovery-title">{showBlockedNotificationRecovery
              ? "ההתראות חסומות במכשיר"
              : "התראות תור אינן פעילות במכשיר הזה"}</strong>
            <small>{showBlockedNotificationRecovery
              ? "לא יגיעו התראות תור ובקשות חברות עד לתיקון ההרשאה."
              : "כדי לקבל התראה כשהיריב משחק, גם כשהאפליקציה סגורה, צריך להפעיל אותן כאן."}</small>
            {turnAlertsMessageIsError && turnAlertsMessage
              ? <small role="status">{turnAlertsMessage}</small>
              : null}
          </div>
          <button type="button" disabled={turnAlertsBusy} onClick={
            showBlockedNotificationRecovery || !pushPublicKey
              ? openDialog
              : () => void enableTurnAlerts()
          }>{showBlockedNotificationRecovery || !pushPublicKey
              ? "פתיחת הוראות בהגדרות"
              : turnAlertsBusy ? "מפעילים…" : "הפעלת התראות"}</button>
          {!showBlockedNotificationRecovery ? (
            <button type="button" disabled={turnAlertsBusy} onClick={() => {
              if (!googleUsername) return;
              storeValue(notificationOfferDecisionKey(googleUsername), "dismissed");
              setNotificationOfferDecision("dismissed");
              setTurnAlertsRefresh((value) => value + 1);
            }}>לא עכשיו</button>
          ) : null}
        </aside>
      ) : null}
      <dialog
        className={styles.dialog}
        ref={dialogRef}
        lang="he"
        dir="rtl"
        translate="no"
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
              <h2 id="app-menu-title">הגדרות</h2>
            </div>
            <button className={styles.close} type="button" onClick={closeDialog} aria-label="סגירה">×</button>
          </div>

          <nav className={styles.quickLinks} aria-label="תפריט ChessRiot">
            <Link href="/app" onClick={closeDialog}><span aria-hidden="true">♟</span>משחק חדש</Link>
            <Link href="/history" onClick={closeDialog}><span aria-hidden="true">↶</span>היסטוריה</Link>
            <Link href="/changelog" onClick={closeDialog}><span aria-hidden="true">✦</span>מה חדש</Link>
          </nav>

          {googleAuthReady && (googleAuthAvailable || googleAccountName || googleAuthMessage) ? (
            <details className={styles.group} open>
              <summary><span aria-hidden="true">●</span><b>חשבון</b></summary>
              <div className={styles.groupBody}>
                {googleAccountName ? (
                  <>
                    <p>מחוברים בתור <strong><bdi dir="auto">{googleAccountName}</bdi></strong>. כל משחק שיוצרים או מצטרפים אליו נשמר אוטומטית.</p>
                    <Link className={styles.communityAction} href="/history" onClick={closeDialog}>צפייה בהיסטוריית המשחקים</Link>
                    <Link className={styles.communityAction} href="/privacy-center" onClick={closeDialog}>פרטיות ונתונים</Link>
                    <button className={styles.action} type="button" onClick={startTutorial}>
                      פתיחת הדרכה קצרה
                    </button>
                    <button
                      className={styles.action}
                      type="button"
                      disabled={googleAuthBusy}
                      onClick={() => void signOutGoogle()}
                    >
                      {googleAuthBusy ? "מתנתקים…" : "התנתקות"}
                    </button>
                  </>
                ) : (
                  <>
                    <p>התחברו באמצעות חשבון Google רשום כדי לשחק ולשמור את כל המשחקים בהיסטוריה.</p>
                    <button className={styles.action} type="button" onClick={startGoogleLogin}>
                      המשך עם Google
                    </button>
                  </>
                )}
                {googleAuthMessage ? (
                  <p
                    className={styles.note}
                    role={googleAuthMessageIsError ? "alert" : "status"}
                  >
                    {googleAuthMessage}
                  </p>
                ) : null}
              </div>
            </details>
          ) : null}

          <details
            className={styles.group}
            open={appearanceOpen}
            onToggle={(event) => setAppearanceOpen(event.currentTarget.open)}
          >
            <summary><span aria-hidden="true">◈</span><b>מראה וערכת עיצוב</b></summary>
            <div className={styles.groupBody}>
              <p>משנה את מראה האפליקציה, כולל מסכים, תפריטים, לוח, כלים, מוזיקה ואפקטים.</p>
              {dialogOpen && appearanceOpen ? <fieldset className={styles.skinGrid}>
              <legend className="visually-hidden">ערכת העיצוב של ChessRiot</legend>
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
            <summary><span aria-hidden="true">♫</span><b>צלילים, מוזיקה ועוצמה</b></summary>
            <div className={styles.groupBody}>
              <label className={styles.toggleRow}>
                <input type="checkbox" checked={soundOn} onChange={toggleSoundEffects} />
                <span><strong>אפקטים קוליים</strong><small>מהלכים, הכאות, שח ותוצאות</small></span>
                <b>{soundOn ? "פעיל" : "כבוי"}</b>
              </label>
              <label className={styles.volumeControl}>
                <span>עוצמת האפקטים</span>
                <output>{Math.round(effectsVolume * 100)}%</output>
                <input type="range" min="0" max="1" step="0.05" value={effectsVolume}
                  onChange={(event) => changeEffectsVolume(Number(event.currentTarget.value))} />
              </label>
              <label className={styles.toggleRow}>
                <input type="checkbox" checked={musicOn} onChange={toggleMusic} />
                <span><strong>מוזיקה</strong><small>מוזיקת רקע לפי ערכת העיצוב</small></span>
                <b>{musicOn ? "פעילה" : "כבויה"}</b>
              </label>
              <label className={styles.volumeControl}>
                <span>עוצמת המוזיקה</span>
                <output>{Math.round(musicVolume * 100)}%</output>
                <input type="range" min="0" max="1" step="0.05" value={musicVolume}
                  onChange={(event) => changeMusicVolume(Number(event.currentTarget.value))} />
              </label>
            </div>
          </details>

          <details className={styles.group}>
            <summary><span aria-hidden="true">✓</span><b>עזרה במשחק</b></summary>
            <div className={styles.groupBody}>
              <label className={styles.toggleRow}><input type="checkbox" checked={chessCoachOn} onChange={toggleCoach} /><span><strong>מאמן שחמט</strong><small>אזהרה לפני מהלכים מסוכנים</small></span><b>{chessCoachOn ? "פעיל" : "כבוי"}</b></label>
              <label className={styles.toggleRow}><input type="checkbox" checked={tacticalCelebrationsOn} onChange={toggleCelebrations} /><span><strong>חגיגות למהלכים מצוינים</strong><small>חגיגה על מזלגות וזכייה בחומר</small></span><b>{tacticalCelebrationsOn ? "פעיל" : "כבוי"}</b></label>
              <label className={styles.toggleRow}><input type="checkbox" checked={confirmEveryMove} onChange={toggleMoveConfirmation} /><span><strong>אישור כל מהלך</strong><small>בקשת אישור לפני שליחת כל מהלך</small></span><b>{confirmEveryMove ? "פעיל" : "כבוי"}</b></label>
            </div>
          </details>

          {googleUsername ? (
            <section
              ref={notificationSettingsRef}
              className={styles.section}
              aria-labelledby="notification-settings-title"
            >
              <h3 id="notification-settings-title"><span aria-hidden="true">♟</span> התראות</h3>
              <p>
                קבלו בקשות חברות, התראות תור והודעות שירות או בדיקה במכשיר הזה, גם כש־ChessRiot סגור.
              </p>
              {!pushReady ? (
                <p className={styles.note} role="status">בודקים את מצב ההתראות…</p>
              ) : !turnAlertsStatusKnown && turnAlertsSupported && turnAlertsAvailable && pushPublicKey ? (
                <div>
                  <p className={styles.note} role="alert">לא הצלחנו לאמת את מצב ההתראות. נסו שוב לפני שינוי ההגדרה.</p>
                  <button
                    className={styles.action}
                    type="button"
                    onClick={() => setTurnAlertsRefresh((value) => value + 1)}
                  >בדיקה חוזרת של ההתראות</button>
                </div>
              ) : !turnAlertsSupported ? (
                <p className={styles.note}>{unsupportedPushMessage(braveBrowser)}</p>
              ) : !turnAlertsAvailable || !pushPublicKey ? (
                <p className={styles.note}>ההתראות אינן מוגדרות בסביבת ChessRiot הזו.</p>
              ) : notificationPermission === "denied" ? (
                <div className={styles.permissionRecovery} role="alert">
                  <strong>ההתראות חסומות בהגדרות המכשיר.</strong>
                  {androidPlatform ? (
                    <ol>
                      <li>פתחו את הגדרות Android ובחרו אפליקציות ← Chrome. אם ChessRiot הותקן כאפליקציה, בחרו ChessRiot במקום Chrome.</li>
                      <li>בחרו התראות והפעילו אישור התראות.</li>
                      <li>ב־Chrome פתחו ⋮ ← הגדרות ← הגדרות אתרים ← התראות ← <bdi dir="ltr">{notificationHostname}</bdi> ובחרו אישור.</li>
                      <li>חזרו ל־ChessRiot ולחצו על הכפתור למטה.</li>
                    </ol>
                  ) : (
                    <p>אפשרו ל־ChessRiot התראות גם בהגדרות האתר בדפדפן וגם בהגדרות ההתראות של המכשיר, ואז חזרו לכאן.</p>
                  )}
                  <button
                    className={styles.action}
                    type="button"
                    onClick={recheckNotificationPermission}
                  >בדקתי, נסו שוב</button>
                </div>
              ) : (
                <label className={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={notificationToggle.checked}
                    disabled={!pushReady || turnAlertsBusy}
                    onChange={() => void (notificationToggle.checked ? disableTurnAlerts() : enableTurnAlerts())}
                  />
                  <span><strong>התראות CHESSRIOT</strong><small>{turnAlertsBusy ? "שומרים…" : notificationToggleDetail}</small></span>
                  <b>{notificationToggleStatus}</b>
                </label>
              )}
              {legacyTurnAlertsEnabled && !turnAlertsEnabled ? (
                <p className={styles.note}>התראות תור עדיין פעילות רק במשחקים ישנים. כבו את ההגדרה כדי לבטל אותן.</p>
              ) : null}
              {turnAlertsEnabled && turnAlertsStatusKnown ? (
                <button
                  className={styles.action}
                  type="button"
                  disabled={turnAlertsBusy}
                  onClick={() => void testTurnAlerts()}
                >{turnAlertsBusy ? "בודקים…" : "בדיקת המכשיר הזה"}</button>
              ) : null}
              {turnAlertsMessage ? (
                <>
                  <p
                    className={styles.note}
                    role={turnAlertsMessageIsError ? "alert" : "status"}
                  >
                    {turnAlertsMessage}
                  </p>
                  {braveBrowser && !mobileNotificationSurface ? (
                    <a
                      href="https://support.brave.app/hc/en-us/articles/360058972091-Push-Notification-Test"
                      target="_blank"
                      rel="noopener noreferrer"
                    >הפעלת הבדיקה הרשמית של Brave</a>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {activeGameId ? (
            <section className={styles.section} aria-labelledby="game-settings-title">
              <h3 id="game-settings-title"><span aria-hidden="true">♜</span> המשחק הנוכחי</h3>
              {gameMenuState && gameMenuState.status !== "completed" ? (
                <button
                  className={`${styles.action} ${styles.danger}`}
                  type="button"
                  onClick={requestSurrender}
                >
                  {gameMenuState?.status === "waiting" ? "ביטול המשחק" : "כניעה"}
                </button>
              ) : null}
            </section>
          ) : null}

          <details className={styles.group}>
            <summary><span aria-hidden="true">✎</span><b>שליחת משוב</b></summary>
            <div className={styles.groupBody}><FeedbackForm /></div>
          </details>

          <details className={styles.group}>
            <summary><span aria-hidden="true">↗</span><b>אפליקציה, עדכונים וקהילה</b></summary>
            <div className={styles.groupBody}>
              <p>
                {availableVersion
                  ? <>גרסה <bdi dir="ltr">v{availableVersion}</bdi> מוכנה. טענו מחדש כדי להשתמש בה.</>
                  : <>מותקנת גרסה <bdi dir="ltr">v{APP_VERSION}</bdi>.</>}
              </p>
              {availableVersion ? (
                <button className={styles.action} type="button" onClick={() => window.location.reload()}>
                  טעינה מחדש של העדכון
                </button>
              ) : null}
              {!installed && installPrompt ? (
                <button className={styles.action} type="button" onClick={() => void installApp()}>
                  התקנת CHESSRIOT
                </button>
              ) : null}
              <a
                className={styles.communityAction}
                href={WHATSAPP_COMMUNITY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                הצטרפות לקהילת WhatsApp
              </a>
            </div>
          </details>
        </div>
      </dialog>
    </>
  );
}
