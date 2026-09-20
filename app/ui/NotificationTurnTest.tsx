"use client";

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
import { confirmTurnTestReceipt, readTurnTestReceipts, turnTestRoundPassed, type TurnTestReceipt } from "@/lib/notification-turn-test-client";
import styles from "./NotificationTurnTest.module.css";

interface Round { gameVersion: number; status: string; attempts: number }
interface Progress { rounds: Round[]; deviceEnabled: boolean; expiresAt: number }
interface Setup { username: string; publicKey: string; registration: ServiceWorkerRegistration }

export function NotificationTurnTest({ game, onRefresh }: { game?: GameSnapshot; onRefresh?: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receipts, setReceipts] = useState<Record<number, TurnTestReceipt>>({});
  const [now, setNow] = useState(() => Date.now());
  const [armed, setArmed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pending = useRef<{ playerToken: string; inviteToken: string; requestId: string } | null>(null);
  const pendingMove = useRef<{ requestId: string; expectedVersion: number; from: string; to: string; promotion?: string } | null>(null);

  useEffect(() => {
    if (game) return;
    let cancelled = false;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("הדפדפן הזה אינו תומך בהתראות. פתחו את ChessRiot ב־Chrome במכשיר ה־Android שברצונכם לבדוק.");
      }
      const [auth, config, registration] = await Promise.all([
        fetchJsonWithReadTimeout<{ account?: { username?: string } }>("/api/auth/session"),
        fetchJsonWithReadTimeout<{ enabled?: boolean; publicKey?: string }>("/api/push/config"),
        preparePushServiceWorker(),
      ]);
      if (!auth.response.ok || !auth.data?.account?.username || !config.response.ok || !config.data?.enabled || !config.data.publicKey) {
        throw new Error("לא ניתן להכין את הבדיקה. ודאו שאתם מחוברים ונסו לרענן.");
      }
      await ensureCurrentPushDiagnosticWorker(registration);
      if (!cancelled) setSetup({ username: auth.data.account.username, publicKey: config.data.publicKey, registration });
    })().catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [game]);

  const refreshProgress = useCallback(async () => {
    if (!game) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error("ההתראות במכשיר הזה אינן רשומות. חזרו לדף הבדיקה והפעילו אותן.");
      const { response, data } = await fetchJsonWithReadTimeout<Progress>(`/api/games/${game.id}/notification-test?endpointHash=${await pushEndpointHash(subscription.endpoint)}`);
      if (!response.ok || !data?.rounds) throw new Error(response.status === 409
        ? "הבדיקה הזו שייכת למכשיר אחר. התחילו בדיקה חדשה במכשיר הזה."
        : "לא הצלחנו לטעון את התוצאות. נסו שוב.");
      setProgress(data);
      setReceipts(await readTurnTestReceipts(game.id, game.version, window.location.pathname === `/g/${game.id}` && document.visibilityState === "visible" && document.hasFocus()));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו לקרוא את תוצאות הבדיקה."); }
  }, [game]);

  useEffect(() => {
    if (!game) return;
    void refreshProgress();
    const refresh = () => { if (document.visibilityState === "visible") void refreshProgress(); };
    const timer = window.setInterval(() => { setNow(Date.now()); refresh(); }, 2_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [game, refreshProgress]);

  async function start() {
    if (!setup || busy) return;
    setBusy(true); setError("");
    window.dispatchEvent(new Event("chessriot:external-push-setup-start"));
    try {
      // Ask directly in the tap handler, before network work loses user activation.
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") {
        throw new Error("יש לאפשר התראות בהגדרות האתר ובהגדרות Android ואז לנסות שוב.");
      }
      if (!mounted.current) return;
      const diagnosticStorage = await caches.open("chessriot-turn-test-v1");
      await diagnosticStorage.put("/__chessriot_turn_test_probe__", new Response("ready"));
      if (!await diagnosticStorage.match("/__chessriot_turn_test_probe__")) throw new Error("הדפדפן אינו מאפשר לשמור תוצאות. נסו חלון רגיל במקום גלישה פרטית.");
      await diagnosticStorage.delete("/__chessriot_turn_test_probe__");
      localStorage.setItem(notificationOfferDecisionKey(setup.username), "setup-pending");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const registration = registerPushDevice({ registration: setup.registration, publicKey: setup.publicKey, expectedUsername: setup.username });
      const subscription = await Promise.race([
        registration,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("הפעלת ההתראות מתעכבת. רעננו את הדף ונסו שוב.")), 15_000); }),
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
      if (!response.ok || !data?.game) throw new Error(data?.error?.message || "לא הצלחנו להתחיל את הבדיקה.");
      localStorage.setItem(playerKey(data.game.id), pending.current.playerToken);
      rememberGame(data.game);
      if (mounted.current) window.location.assign(`/g/${data.game.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו להתחיל את הבדיקה."); }
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
        if (!move) throw new Error("אין מהלך זמין. התחילו בדיקה חדשה.");
        pendingMove.current = { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}), expectedVersion: game.version, requestId: generateUuid() };
      }
      const { response, data } = await fetchJsonWithReadTimeout<{ game?: GameSnapshot; error?: { message?: string } }>(`/api/games/${game.id}/moves`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pendingMove.current),
      });
      if (!response.ok || !data?.game) throw new Error(data?.error?.message || "המהלך לא נשמר. נסו שוב.");
      pendingMove.current = null;
      setArmed(true);
      onRefresh?.();
    } catch (e) { setError(e instanceof Error ? e.message : "המהלך לא נשמר. נסו שוב."); }
    finally { setBusy(false); }
  }

  async function finishTest(destination: string) {
    if (!game || busy) return;
    setBusy(true); setError("");
    try {
      if (game.status !== "completed") {
        const { response } = await fetchJsonWithReadTimeout(`/api/games/${game.id}/end`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: game.version, requestId: generateUuid() }),
        });
        if (!response.ok) { onRefresh?.(); throw new Error("המשחק השתנה. לחצו שוב כדי לסיים את הבדיקה."); }
      }
      window.location.assign(destination);
    } catch (e) { setError(e instanceof Error ? e.message : "לא הצלחנו לסיים. נסו שוב."); }
    finally { setBusy(false); }
  }

  const passed = [2, 4, 6, 8].filter((v) => turnTestRoundPassed(receipts[v])).length;
  const pendingReply = Boolean(game && game.turn !== game.you.color && game.status === "active");
  const done = Boolean(game && game.plyCount >= 8);
  const expired = Boolean(game?.notificationTest && now >= game.notificationTest.expiresAt);
  const currentReceipt = game ? receipts[game.version] : undefined;
  const canConfirm = Boolean(currentReceipt?.clickedAt && currentReceipt.openedAt && !currentReceipt.confirmedAt && currentReceipt.visibleClients === 0);
  const readyForNext = !game || game.version === 0 || turnTestRoundPassed(currentReceipt);
  return <section className={styles.panel} lang="he" dir="rtl" aria-labelledby="turn-test-title">
    <div className={styles.heading}><span aria-hidden="true">♞</span><div>
      <p>מכשיר אחד · יריב אוטומטי · 4 תורים</p>
      <h1 id="turn-test-title">בדיקת התראות מלאה</h1>
    </div></div>
    {!game ? <>
      <p>בודקים את מכשיר ה־Android הזה בלבד. Riot Bot ישחק נגדכם, וישלח התראת תור אמיתית גם כש־ChessRiot סגור.</p>
      <ol><li>לוחצים על ״המהלך הבא״.</li><li>עוברים למסך הבית או נועלים את הטלפון. בתור השלישי נסו גם לסגור את ChessRiot מרשימת האפליקציות האחרונות (או לסגור את הלשונית).</li><li>ממתינים להתראה, מקישים עליה וחוזרים למשחק. חוזרים כך 4 פעמים.</li></ol>
      <p>לא צריך מכשיר נוסף או חשבון נוסף. אל תבחרו ״אילוץ עצירה״ בהגדרות Android.</p>
      <button type="button" onClick={() => void start()} disabled={!setup || busy}>{busy ? "מכינים את המשחק…" : setup ? "הפעלת התראות והתחלת בדיקה" : "מכינים את הבדיקה…"}</button>
      <Link href="/app">חזרה למשחקים</Link>
    </> : <>
      <p className={styles.summary} role="status">{passed === 4 ? "הבדיקה הושלמה: 4 התראות התקבלו כשהאפליקציה לא הייתה גלויה, והקשה עליהן פתחה את המשחק." : `${passed} מתוך 4 תורים אומתו במכשיר הזה`}</p>
      {pendingReply || (armed && game.version === 0) ? <p className={styles.instruction} role="status"><strong>עכשיו עברו למסך הבית או נעלו את הטלפון.</strong><br />Riot Bot ישיב כ־8 שניות אחרי המהלך. כשההתראה תגיע, הקישו עליה.{game.plyCount === 5 ? " בתור הזה נסו גם לסגור את ChessRiot מרשימת האפליקציות האחרונות, או לסגור את הלשונית בדפדפן." : ""}</p> : null}
      {!pendingReply && game.status === "active" && !done && readyForNext && !expired ? <button type="button" onClick={() => void nextMove()} disabled={busy || !progress?.deviceEnabled}>{busy ? "שומרים את המהלך…" : `המהלך הבא · תור ${Math.floor(game.plyCount / 2) + 1} מתוך 4`}</button> : null}
      {canConfirm ? <button type="button" onClick={() => {
        void confirmTurnTestReceipt(game.id, game.version).then(refreshProgress).catch(() => setError("לא הצלחנו לשמור את האישור. נסו שוב."));
      }}>ראיתי התראת Android והקשה עליה פתחה את המשחק הזה</button> : null}
      {!pendingReply && game.version > 0 && !readyForNext && !canConfirm ? <p className={styles.instruction}>התור עדיין לא אומת. חזרו דרך ההתראה שבמגירת ההתראות. אם לא הופיעה התראה, בדקו למטה היכן נעצרה הבדיקה.</p> : null}
      {pendingReply && game.notificationTest?.replyDueAt && now > game.notificationTest.replyDueAt + 20_000 ? <p role="alert">התשובה מתעכבת. הבדיקה עדיין לא עברה. אפשר לרענן או להתחיל בדיקה חדשה.</p> : null}
      {game.status === "completed" && passed < 4 ? <p>המשחק הסתיים לפני השלמת הבדיקה. התחילו בדיקה חדשה.</p> : null}
      {expired ? <p role="alert">תוקף הבדיקה הסתיים. התחילו בדיקה חדשה.</p> : null}
      <ol className={styles.rounds}>{[2, 4, 6, 8].map((v, index) => {
        const receipt = receipts[v]; const delivery = progress?.rounds.find((r) => r.gameVersion === v);
        return <li key={v} data-passed={turnTestRoundPassed(receipt)}><strong>תור {index + 1}{turnTestRoundPassed(receipt) ? " · עבר" : ""}</strong>
          <span>{delivery ? delivery.status === "sent" ? "השרת שלח" : `שליחה: ${delivery.status === "dead" || delivery.status === "stale" ? "נכשלה" : "ממתינה"}` : "ממתין למהלך"}
            {receipt?.receivedAt ? " · המכשיר קיבל" : ""}{receipt?.shownAt ? " · הדפדפן יצר התראה" : ""}{receipt?.showRejectedAt ? " · ההצגה נכשלה" : ""}{receipt?.clickedAt ? " · הוקשה" : ""}{receipt?.openedAt ? " · המשחק נפתח" : ""}</span>
          {receipt?.receivedAt && receipt.windowClients === 0 ? <small>כל מסכי ChessRiot היו סגורים בזמן הקבלה.</small> : null}
          {receipt?.receivedAt && receipt.visibleClients !== 0 ? <small>ChessRiot היה גלוי או שלא ניתן לאמת שהיה סגור. התור אינו נחשב לבדיקה עם האפליקציה סגורה.</small> : null}
        </li>;
      })}</ol>
      <p className={styles.note}>״השרת שלח״ לבדו אינו הוכחה להתראה בטלפון. תור עובר רק לאחר קבלה כשהאפליקציה אינה גלויה, הקשה, פתיחת המשחק ואישור שלכם.</p>
      {progress && !progress.deviceEnabled ? <p role="alert">ההתראות במכשיר הזה בוטלו. יש להפעיל אותן מחדש.</p> : null}
      <div className={styles.links}><button type="button" className={styles.secondary} onClick={() => { onRefresh?.(); void refreshProgress(); }}>רענון התוצאות</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void finishTest("/notification-test")}>בדיקה חדשה</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void finishTest("/app")}>סיום וחזרה למשחקים</button></div>
    </>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>;
}
