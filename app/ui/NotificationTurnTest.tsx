"use client";

import { useLanguage } from "./LanguageProvider";


import Link from "next/link";
import { Chess } from "chess.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/game-types";
import { generateSecret, generateUuid, playerKey, rememberGame } from "@/lib/client-storage";
import { preparePushServiceWorker, registerPushDevice } from "@/lib/push-registration-client";
import { ensureCurrentPushDiagnosticWorker } from "@/lib/push-diagnostics";
import { pushEndpointHash, setPushConsentEnabled } from "@/lib/push-client";
import { notificationOfferDecisionKey, PUSH_DEVICE_OWNER_KEY } from "@/lib/pwa";
import { fetchJsonWithReadTimeout } from "@/lib/client-recovery";
import { clearEndedTurnTestNotification, confirmTurnTestReceipt, readTurnTestReceipts, turnTestRoundPassed, type TurnTestReceipt } from "@/lib/notification-turn-test-client";
import { notificationTestFlow } from "@/lib/notification-turn-test-flow";
import styles from "./NotificationTurnTest.module.css";

interface Round { gameVersion: number; status: string; attempts: number }
interface Progress { rounds: Round[]; deviceEnabled: boolean; expiresAt: number }
interface Setup { username: string; publicKey: string; registration: ServiceWorkerRegistration }

export function NotificationTurnTest({ game, onRefresh }: { game?: GameSnapshot; onRefresh?: () => void }) {
  const { locale, dir, t } = useLanguage();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receipts, setReceipts] = useState<Record<number, TurnTestReceipt>>({});
  const [now, setNow] = useState(() => Date.now());
  const [submittedVersion, setSubmittedVersion] = useState<number | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [readError, setReadError] = useState("");
  const [deviceIssue, setDeviceIssue] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = useRef<{ playerToken: string; inviteToken: string; requestId: string } | null>(null);
  const pendingMove = useRef<{ requestId: string; expectedVersion: number; from: string; to: string; promotion?: string } | null>(null);

  useEffect(() => {
    if (game) return;
    let cancelled = false;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("This browser does not support notifications. Open ChessRiot in Chrome on the Android phone you want to test.");
      }
      const [auth, config, registration] = await Promise.all([
        fetchJsonWithReadTimeout<{ account?: { username?: string } }>("/api/auth/session"),
        fetchJsonWithReadTimeout<{ enabled?: boolean; publicKey?: string }>("/api/push/config"),
        preparePushServiceWorker(),
      ]);
      if (!auth.response.ok || !auth.data?.account?.username || !config.response.ok || !config.data?.enabled || !config.data.publicKey) {
        throw new Error("Could not prepare the test. Check your connection and try again.");
      }
      await ensureCurrentPushDiagnosticWorker(registration);
      if (!cancelled) setSetup({ username: auth.data.account.username, publicKey: config.data.publicKey, registration });
    })().catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [game, setupAttempt]);

  const refreshProgress = useCallback(async () => {
    if (!game) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setDeviceIssue("Notifications are not connected on this phone. Start again to connect them.");
        return;
      }
      const { response, data } = await fetchJsonWithReadTimeout<Progress>(`/api/games/${game.id}/notification-test?endpointHash=${await pushEndpointHash(subscription.endpoint)}`);
      if (response.status === 409 || response.status === 404) {
        setDeviceIssue("This test belongs to another device or is no longer available. Start a test on this phone.");
        return;
      }
      if (!response.ok || !data?.rounds) throw new Error("Could not check the result yet. Check your connection and try again.");
      const nextReceipts = await readTurnTestReceipts(game.id, game.version,
        window.location.pathname === `/g/${game.id}` && document.visibilityState === "visible" && document.hasFocus());
      if (!mounted.current) return;
      setProgress(data);
      setReceipts(nextReceipts);
      setDeviceIssue("");
      setReadError("");
    } catch {
      if (mounted.current) setReadError("Could not check the result yet. Check your connection and try again.");
    }
  }, [game]);

  useEffect(() => {
    if (!game) return;
    void refreshProgress();
    const refresh = () => { if (document.visibilityState === "visible") void refreshProgress(); };
    const timer = window.setInterval(() => { setNow(Date.now()); refresh(); }, 2_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [game, refreshProgress]);

  async function start() {
    if (!setup || busy) return;
    setBusy(true); setError("");
    window.dispatchEvent(new Event("chessriot:external-push-setup-start"));
    try {
      // Ask directly in the tap handler, before network work loses user activation.
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") {
        throw new Error("Allow notifications in your browser and Android settings, then try again.");
      }
      if (!mounted.current) return;
      const diagnosticStorage = await caches.open("chessriot-turn-test-v1");
      await diagnosticStorage.put("/__chessriot_turn_test_probe__", new Response("ready"));
      if (!await diagnosticStorage.match("/__chessriot_turn_test_probe__")) throw new Error("This browser cannot save test results. Use a regular window instead of private browsing.");
      await diagnosticStorage.delete("/__chessriot_turn_test_probe__");
      localStorage.setItem(notificationOfferDecisionKey(setup.username), "setup-pending");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const registration = registerPushDevice({ registration: setup.registration, publicKey: setup.publicKey, expectedUsername: setup.username });
      const subscription = await Promise.race([
        registration,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Notification setup timed out. Try again.")), 15_000); }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      if (!mounted.current) return;
      localStorage.setItem(notificationOfferDecisionKey(setup.username), "enabled");
      localStorage.setItem(PUSH_DEVICE_OWNER_KEY, setup.username);
      await setPushConsentEnabled(true, setup.username);
      if (!mounted.current) return;
      pending.current ??= { playerToken: generateSecret(), inviteToken: generateSecret(), requestId: generateUuid() };
      const { response, data } = await fetchJsonWithReadTimeout<{ game?: GameSnapshot; error?: { message?: string } }>("/api/games", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...pending.current, mode: "solo", difficulty: 1, variantId: "standard", notificationTestEndpoint: subscription.endpoint }),
      });
      if (!response.ok || !data?.game) throw new Error(data?.error?.message || "Could not start the test. Try again.");
      localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
      rememberGame(data.game);
      if (mounted.current) window.location.assign(`/g/${data.game.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the test. Try again."); }
    finally { if (mounted.current) setBusy(false); window.dispatchEvent(new Event("chessriot:external-push-setup-end")); }
  }

  async function nextMove() {
    if (!game || busy) return;
    setBusy(true); setError("");
    try {
      if (!pendingMove.current || pendingMove.current.expectedVersion !== game.version) {
        const legal = new Chess(game.fen).moves({ verbose: true });
        const preferred = ["e2e4", "g1f3", "b1c3", "d2d3"];
        const move = preferred.map((squares) => legal.find((m) => `${m.from}${m.to}` === squares)).find(Boolean) ?? legal[0];
        if (!move) throw new Error("No legal move is available. Start a new test.");
        pendingMove.current = { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}), expectedVersion: game.version, requestId: generateUuid() };
      }
      const { response, data } = await fetchJsonWithReadTimeout<{ game?: GameSnapshot; error?: { message?: string } }>(`/api/games/${game.id}/moves`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pendingMove.current),
      });
      if (!response.ok || !data?.game) throw new Error(data?.error?.message || "The move could not be confirmed. Try again.");
      pendingMove.current = null;
      setSubmittedVersion(data.game.version);
      onRefresh?.();
    } catch (e) { setError(e instanceof Error ? e.message : "The move could not be confirmed. Try again."); }
    finally { setBusy(false); }
  }

  async function finishTest(destination: string) {
    if (!game || busy) return;
    setBusy(true); setError("");
    try {
      let finishedGame = game;
      if (game.status !== "completed") {
        const { response, data } = await fetchJsonWithReadTimeout<{ game?: GameSnapshot }>(`/api/games/${game.id}/end`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: game.version, requestId: generateUuid() }),
        });
        if (!response.ok || !data?.game) { onRefresh?.(); throw new Error("The game just changed. Tap again to finish the test."); }
        finishedGame = data.game;
      }
      await clearEndedTurnTestNotification(finishedGame);
      window.location.assign(destination);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not finish the test. Try again."); }
    finally { setBusy(false); }
  }

  async function confirmRound() {
    if (!game || busy) return;
    setBusy(true); setError("");
    try {
      await confirmTurnTestReceipt(game.id, game.version);
      await refreshProgress();
    } catch { setError("Could not save your confirmation. Try again."); }
    finally { if (mounted.current) setBusy(false); }
  }

  const effectiveVersion = Math.max(game?.version ?? 0, submittedVersion ?? 0);
  const pendingReply = Boolean(game?.status === "active" && (game.turn !== game.you.color || effectiveVersion > game.version));
  const roundVersion = Math.min(8, Math.max(2, Math.ceil(effectiveVersion / 2) * 2));
  const currentDelivery = progress?.rounds.find((r) => r.gameVersion === roundVersion);
  const flow = notificationTestFlow({
    version: effectiveVersion,
    pendingReply,
    completed: game?.status === "completed",
    expired: Boolean(game?.notificationTest && now >= game.notificationTest.expiresAt),
    deviceEnabled: progress?.deviceEnabled,
    deviceIssue,
    deliveryFailed: currentDelivery?.status === "dead" || currentDelivery?.status === "stale",
    receipts,
  });
  const refreshing = Boolean(readError && flow.phase !== "blocked" && flow.phase !== "complete");
  const late = Boolean(pendingReply && game?.notificationTest?.replyDueAt && now > game.notificationTest.replyDueAt + 20_000);
  const time = (timestamp?: number) => timestamp ? new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not yet";
  const retryRead = () => { setError(""); onRefresh?.(); void refreshProgress(); };

  return <section className={styles.panel} lang={locale} dir={dir} aria-labelledby="turn-test-title">
    <p className={styles.eyebrow}>{t("THIS PHONE · 4 ROUNDS")}</p>
    <h1 id="turn-test-title">{game ? t("Notification test") : t("Test your notifications")}</h1>
    {!game ? <>
      <p>{t("Check real game notifications on this Android. No second device needed.")}</p>
      <p>{t("We will guide you through four rounds: leave the app, then tap the notification to return.")}</p>
      {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
      {!setup && error ? <button type="button" onClick={() => { setError(""); setSetupAttempt((v) => v + 1); }}>{t("Try setup again")}</button>
        : <button type="button" onClick={() => void start()} disabled={!setup || busy}>{busy ? t("Connecting this phone…") : setup ? t("Start test") : t("Preparing…")}</button>}
      <details className={styles.details}><summary>{t("How the test works")}</summary>
        <p>{t("Each round plays a real move against Riot Bot. It replies after about eight seconds and sends a normal turn notification only to this phone.")}</p>
        <p>{t("We check delivery, your tap, and return to the correct game. You confirm that Android actually showed the notification. One round also asks you to close the app.")}</p>
        <p>{t("Use Home, lock the phone, or close the app from Recents. Do not use Android’s Force stop.")}</p>
      </details>
      <Link className={styles.exit} href="/app">{t("Back to games")}</Link>
    </> : <>
      <ol className={styles.progress} aria-label={t("${p0} of 4 rounds verified", {p0: flow.passed})}>
        {[2, 4, 6, 8].map((v, i) => <li key={v} data-passed={turnTestRoundPassed(receipts[v])} aria-current={flow.phase !== "complete" && flow.round === i + 1 ? "step" : undefined}>
          <span aria-hidden="true">{turnTestRoundPassed(receipts[v]) ? "✓" : i + 1}</span><small>{t("Round")}{" "}{i + 1}{turnTestRoundPassed(receipts[v]) ? t(" verified") : ""}</small>
        </li>)}
      </ol>
      <div className={styles.step} aria-live="polite" aria-atomic="true">
        {refreshing ? <><h2>{t("Let’s check the result")}</h2><p>{t(readError)}</p></> :
          flow.phase === "complete" ? <><h2>{t("All four rounds verified")}</h2><p>{t("You received and opened all four notifications while ChessRiot was off screen.")}</p></> :
          flow.phase === "blocked" ? <><h2>{t("This test needs a restart")}</h2><p>{t(flow.reason ?? "")}</p></> :
          flow.phase === "checking" ? <><h2>{t("Checking this phone…")}</h2><p>{t("Your test results will appear here.")}</p></> :
          flow.phase === "confirm" ? <><h2>{t("Did you see the notification?")}</h2><p>{t("Confirm that you saw the Android notification and tapped it to return to this game.")}</p></> :
          flow.phase === "ready" ? <>
            <h2>{flow.passed ? t("Round ${p0} verified", {p0: flow.passed}) : t("Ready for round 1?")}</h2>
            <p>{flow.round === 3 ? t("After tapping below, close ChessRiot from Recents, or close its browser tab. Tap the notification to return.")
              : t("Tap below, then go Home or lock your phone. Tap the notification to return.")}</p>
            <p className={styles.note}>{t("Riot Bot replies after about eight seconds.")}</p>
          </> : <>
            <h2>{pendingReply ? flow.round === 3 ? t("Close ChessRiot now") : t("Lock your phone now") : t("Tap your notification")}</h2>
            <p>{pendingReply ? flow.round === 3
              ? t("Close it from Recents or close this browser tab. Tap the notification when it arrives.")
              : t("Or go to your Home screen. Tap the notification when it arrives.")
              : t("Swipe down to open Android notifications, then tap the ChessRiot turn notification.")}</p>
            {pendingReply ? <p className={styles.note}>{t("The reply takes about eight seconds. You do not need to keep this page open.")}</p> : null}
          </>}
      </div>
      {error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
      {refreshing ? <button type="button" disabled={busy} onClick={retryRead}>{t("Try again")}</button> :
        flow.phase === "complete" ? <button type="button" disabled={busy} onClick={() => void finishTest("/app")}>{busy ? t("Finishing…") : t("Done")}</button> :
        flow.phase === "blocked" ? <button type="button" disabled={busy} onClick={() => void finishTest("/notification-test")}>{busy ? t("Restarting…") : t("Restart test")}</button> :
        flow.phase === "confirm" ? <button type="button" disabled={busy} onClick={() => void confirmRound()}>{busy ? t("Saving…") : t("Yes, I saw it and tapped it")}</button> :
        flow.phase === "ready" ? <button type="button" disabled={busy} onClick={() => void nextMove()}>{busy ? t("Starting this round…") : t("Send notification ${p0}", {p0: flow.round})}</button> : null}
      {late ? <p className={styles.note} role="status">{t("The reply is taking longer than expected. This round has not passed yet.")}</p> : null}
      <details className={styles.details}><summary>{t("Need help?")}</summary>
        <p>{t("If nothing arrives, check Android and browser notification permissions for ChessRiot. Do not use Force stop.")}</p>
        <p>{t("Opening the app manually leaves your notification available. Swipe down to open Android notifications and tap it to continue this round.")}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={busy} onClick={retryRead}>{t("Check again")}</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void finishTest("/notification-test")}>{t("Start a new test")}</button>
        </div>
      </details>
      <details className={styles.details}><summary>{t("Full test results ·")}{" "}{flow.passed}{t("/4 verified")}</summary>
        <p className={styles.note}>{t("Each round requires receipt while the app is off screen, notification creation, your tap, this game opening, and your confirmation, in that order.")}</p>
        <ol className={styles.rounds}>{[2, 4, 6, 8].map((v, index) => {
          const receipt = receipts[v]; const delivery = progress?.rounds.find((r) => r.gameVersion === v);
          return <li key={v} data-passed={turnTestRoundPassed(receipt)}>
            <strong>{t("Round")}{" "}{index + 1} · {turnTestRoundPassed(receipt) ? t("Verified") : t("Not verified")}</strong>
            <dl>
              <dt>{t("Server delivery")}</dt><dd>{delivery?.status === "sent" ? t("Push provider accepted") : t(delivery?.status ?? "No move yet")}{delivery ? t(" · ${p0} attempt(s)", {p0: delivery.attempts}) : ""}</dd>
              <dt>{t("Phone received")}</dt><dd>{time(receipt?.receivedAt)}</dd>
              <dt>{t("Notification created")}</dt><dd>{receipt?.showRejectedAt ? t("Failed at ${p0}", {p0: time(receipt.showRejectedAt)}) : time(receipt?.shownAt)}</dd>
              <dt>{t("Notification tapped")}</dt><dd>{time(receipt?.clickedAt)}</dd>
              <dt>{t("Correct game opened")}</dt><dd>{time(receipt?.openedAt)}</dd>
              <dt>{t("You confirmed")}</dt><dd>{time(receipt?.confirmedAt)}</dd>
              <dt>{t("Visible app windows")}</dt><dd>{receipt?.visibleClients ?? t("Unknown")}</dd>
              <dt>{t("Open app windows")}</dt><dd>{receipt?.windowClients ?? t("Unknown")}</dd>
            </dl>
            {receipt?.receivedAt && receipt.windowClients === 0 ? <small>{t("All ChessRiot windows were closed when this arrived.")}</small> : null}
          </li>;
        })}</ol>
        <p className={styles.note}>{t("This phone:")}{" "}{progress ? progress.deviceEnabled ? t("notifications enabled") : t("notifications disabled") : "checking"}{t(". Test expires at")}{" "}{time(progress?.expiresAt ?? game.notificationTest?.expiresAt)}.</p>
      </details>
      {flow.phase !== "complete" ? <button type="button" className={styles.exit} disabled={busy} onClick={() => void finishTest("/app")}>{t("Exit test")}</button> : null}
    </>}
  </section>;
}
