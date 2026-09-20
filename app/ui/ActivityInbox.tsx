"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonWithReadTimeout } from "@/lib/client-recovery";
import { generateUuid } from "@/lib/client-storage";
import { reportProductEvent } from "@/lib/client-telemetry";

export const ACTIVITY_CHANGED_EVENT = "chessriot:activity-changed";
const ACTIVITY_POLL_MS = 30_000;

interface ActivityItem {
  id: string;
  kind: "friend_request" | "challenge" | "turn" | "result";
  title: string;
  detail: string;
  createdAt: string;
  unread: boolean;
  href: string | null;
  requestId: string | null;
  gameId: string | null;
  username: string | null;
}

interface ActivityPayload {
  items?: unknown;
  unreadCount?: unknown;
  snapshotAt?: unknown;
}

function activityItems(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (
      typeof row.id !== "string"
      || !["friend_request", "challenge", "turn", "result"].includes(String(row.kind))
      || typeof row.title !== "string"
      || typeof row.detail !== "string"
      || typeof row.createdAt !== "string"
    ) return [];
    return [{
      id: row.id,
      kind: row.kind as ActivityItem["kind"],
      title: row.title,
      detail: row.detail,
      createdAt: row.createdAt,
      unread: row.unread === true,
      href: typeof row.href === "string" ? row.href : null,
      requestId: typeof row.requestId === "string" ? row.requestId : null,
      gameId: typeof row.gameId === "string" ? row.gameId : null,
      username: typeof row.username === "string" ? row.username : null,
    }];
  });
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "עכשיו";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

const ICONS: Record<ActivityItem["kind"], string> = {
  friend_request: "+",
  challenge: "⚔",
  turn: "♞",
  result: "✓",
};

function activityTitle(kind: ActivityItem["kind"]): string {
  if (kind === "friend_request") return "בקשת חברות";
  if (kind === "challenge") return "הזמנה למשחק";
  if (kind === "turn") return "תורך";
  return "המשחק הסתיים";
}

function actor(item: ActivityItem): ReactNode {
  return item.username
    ? <bdi dir="auto">@{item.username}</bdi>
    : "שחקן אחר";
}

function activityDetail(item: ActivityItem): ReactNode {
  if (item.kind === "friend_request") return <>{actor(item)} רוצה להתחבר אליך.</>;
  if (item.kind === "challenge") return <>{actor(item)} הזמין אותך למשחק.</>;
  if (item.kind === "turn") return item.username
    ? <>זה הזמן לשחק מול {actor(item)}.</>
    : "זה הזמן למהלך הבא שלך.";
  const results: Record<string, string> = {
    "You won": "ניצחת.",
    "You lost": "הפסדת.",
    Draw: "תיקו.",
    "Game cancelled": "המשחק בוטל.",
  };
  return results[item.detail] ?? "המשחק הסתיים.";
}

function publishActivityChanged(): void {
  window.dispatchEvent(new Event(ACTIVITY_CHANGED_EVENT));
}

export function ActivityInbox() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refreshGeneration = useRef(0);
  const refreshAbort = useRef<AbortController | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const notificationLinkHandled = useRef(false);

  const refresh = useCallback(async () => {
    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    try {
      const { response, data: payload } = await fetchJsonWithReadTimeout<ActivityPayload>("/api/me/activity", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok || !payload) throw new Error();
      if (generation !== refreshGeneration.current) return;
      setItems(activityItems(payload.items));
      setUnreadCount(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
      setSnapshotAt(typeof payload.snapshotAt === "string" ? payload.snapshotAt : null);
      setMessage("");
    } catch {
      if (generation !== refreshGeneration.current || controller.signal.aborted) return;
      setMessage("לא הצלחנו לרענן את ההתראות.");
    } finally {
      if (refreshAbort.current === controller) refreshAbort.current = null;
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refresh().then(() => {
      if (cancelled || notificationLinkHandled.current) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("activity") !== "1") return;
      notificationLinkHandled.current = true;
      url.searchParams.delete("activity");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      reportProductEvent("activity.opened");
      dialogRef.current?.showModal();
    });
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshVisible, ACTIVITY_POLL_MS);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    window.addEventListener(ACTIVITY_CHANGED_EVENT, refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      cancelled = true;
      refreshGeneration.current += 1;
      refreshAbort.current?.abort();
      refreshAbort.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      window.removeEventListener(ACTIVITY_CHANGED_EVENT, refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  async function markRead() {
    if (!snapshotAt || !unreadCount) return;
    const currentSnapshot = snapshotAt;
    refreshGeneration.current += 1;
    refreshAbort.current?.abort();
    refreshAbort.current = null;
    setUnreadCount(0);
    setItems((current) => current.map((item) => ({ ...item, unread: false })));
    try {
      await fetch("/api/me/activity", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshotAt: currentSnapshot }),
      });
    } catch {
      // A later refresh restores the durable unread state if this request failed.
    }
  }

  function open() {
    if (!dialogRef.current) return;
    reportProductEvent("activity.opened");
    dialogRef.current.showModal();
    void markRead();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function answerFriend(item: ActivityItem, action: "accept" | "decline") {
    if (!item.requestId) return;
    setBusyId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/me/friend-requests/${encodeURIComponent(item.requestId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error();
      setMessage(action === "accept" ? "החבר נוסף." : "הבקשה נדחתה.");
      publishActivityChanged();
      await refresh();
    } catch {
      setMessage("לא הצלחנו לעדכן את הבקשה.");
    } finally {
      setBusyId(null);
    }
  }

  async function answerChallenge(item: ActivityItem, action: "accept" | "decline") {
    if (!item.gameId) return;
    setBusyId(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(item.gameId)}/challenge`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, requestId: generateUuid() }),
      });
      if (!response.ok) throw new Error();
      if (action === "accept") {
        window.location.assign(`/g/${encodeURIComponent(item.gameId)}`);
        return;
      }
      setMessage("ההזמנה נדחתה.");
      publishActivityChanged();
      await refresh();
    } catch {
      setMessage("לא הצלחנו לעדכן את ההזמנה.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <button
        className="activity-trigger"
        type="button"
        ref={triggerRef}
        lang="he"
        dir="rtl"
        translate="no"
        aria-label={unreadCount ? `התראות, ${unreadCount} לא נקראו` : "התראות"}
        aria-haspopup="dialog"
        onClick={open}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount ? <b>{Math.min(unreadCount, 99)}</b> : null}
      </button>
      <dialog
        className="activity-dialog"
        ref={dialogRef}
        lang="he"
        dir="rtl"
        translate="no"
        aria-labelledby="activity-title"
        onClose={() => triggerRef.current?.focus()}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <section className="activity-panel">
          <header><div><p>מרכז עדכונים</p><h2 id="activity-title">התראות</h2></div><button type="button" onClick={close} aria-label="סגירת ההתראות">×</button></header>
          <div className="activity-list">
            {loading ? <p className="activity-empty" role="status">בודקים התראות…</p> : items.length ? items.map((item) => (
              <article className="activity-item" data-unread={item.unread} key={item.id}>
                <span className="activity-icon" aria-hidden="true">{ICONS[item.kind]}</span>
                <div><strong>{activityTitle(item.kind)}</strong><p>{activityDetail(item)}</p><small>{relativeTime(item.createdAt)}</small></div>
                {item.kind === "friend_request" && item.requestId ? <div className="activity-actions">
                  <button type="button" disabled={busyId !== null} onClick={() => void answerFriend(item, "accept")}>אישור</button>
                  <button type="button" disabled={busyId !== null} onClick={() => void answerFriend(item, "decline")}>דחייה</button>
                </div> : item.kind === "challenge" && item.gameId ? <div className="activity-actions">
                  <button type="button" disabled={busyId !== null} onClick={() => void answerChallenge(item, "accept")}>אישור ומשחק</button>
                  <button type="button" disabled={busyId !== null} onClick={() => void answerChallenge(item, "decline")}>דחייה</button>
                </div> : item.href ? <Link href={item.href} onClick={close}>פתיחה</Link> : null}
              </article>
            )) : <div className="activity-empty"><span aria-hidden="true">✓</span><strong>הכול מעודכן</strong><p>הזמנות, תורות, בקשות ותוצאות יופיעו כאן.</p></div>}
          </div>
          {message ? <p className="activity-message" role="status">{message}</p> : null}
        </section>
      </dialog>
    </>
  );
}
