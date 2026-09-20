import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GameSnapshot, Termination } from "@/lib/game-types";

const REASON_LABELS: Record<Termination, string> = {
  checkmate: "מט",
  resignation: "כניעה",
  stalemate: "פט",
  insufficient_material: "אין מספיק כלים למט",
  threefold_repetition: "חזרה משולשת",
  fivefold_repetition: "חזרה מחומשת",
  fifty_move: "כלל 50 המהלכים",
  seventy_five_move: "כלל 75 המהלכים",
  cancelled: "המשחק בוטל",
  timeout: "הזמן נגמר",
  draw: "תיקו",
};

function outcomeHeading(game: GameSnapshot): string {
  if (game.outcome?.reason === "cancelled") return "המשחק בוטל";
  if (!game.outcome || game.outcome.winner === null) return "המשחק הסתיים בתיקו";
  return game.outcome.winner === game.you.color ? "ניצחת" : "הפסדת";
}

export function PostGamePanel({
  game,
  onDismiss,
  onReview,
}: {
  game: GameSnapshot;
  onDismiss: () => void;
  onReview: () => void;
}) {
  const setup = new URLSearchParams({ mode: game.mode, variant: game.variantId });
  if (game.aiDifficulty) setup.set("difficulty", String(game.aiDifficulty));
  if (game.turnPaceDays) setup.set("pace", String(game.turnPaceDays));
  if (game.magicRules) setup.set("magic", game.magicRules.prompt);
  if (game.mode === "multiplayer") {
    const opponent = game.you.color === "w"
      ? game.players.black?.name
      : game.players.white.name;
    if (opponent) setup.set("opponent", opponent);
  }
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [recapUrl, setRecapUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState(false);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  async function shareRecap() {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError(false);
    setShareMessage("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}/recap-share`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json() as {
        url?: unknown;
        error?: { message?: unknown };
      };
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error("לא הצלחנו ליצור קישור לסיכום המשחק.");
      }
      setRecapUrl(payload.url);
      const data = {
        title: `${game.players.white.name} נגד ${game.players.black?.name ?? "Riot Bot"} ב־ChessRiot`,
        text: "אפשר לצפות שוב במשחק ChessRiot שהסתיים.",
        url: payload.url,
      };
      if (typeof navigator.share === "function") {
        try {
          await navigator.share(data);
          setShareMessage("הסיכום שותף. כל מי שיש לו את הקישור יכול לראות את השמות והמהלכים.");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setShareMessage("קישור הסיכום מוכן.");
            return;
          }
        }
      }
      await navigator.clipboard.writeText(payload.url);
      setShareMessage("קישור הסיכום הועתק. כל מי שיש לו את הקישור יכול לראות את השמות והמהלכים.");
    } catch {
      setShareError(true);
      setShareMessage("לא הצלחנו ליצור קישור לסיכום המשחק.");
    } finally {
      setShareBusy(false);
    }
  }

  async function stopSharing() {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError(false);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}/recap-share`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      setRecapUrl("");
      setShareMessage("קישור הסיכום כבר אינו פעיל.");
    } catch {
      setShareError(true);
      setShareMessage("לא הצלחנו להפוך את הסיכום לפרטי. יש לנסות שוב.");
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <section className="post-game-panel" dir="rtl" aria-labelledby="post-game-title" role="region">
      <button className="post-game-dismiss" type="button" onClick={onDismiss} aria-label="סגירת תוצאת המשחק">×</button>
      <small>תוצאה סופית</small>
      <h2 id="post-game-title" ref={titleRef} tabIndex={-1}>{outcomeHeading(game)}</h2>
      <p>{game.outcome ? REASON_LABELS[game.outcome.reason] : "המשחק הסתיים"}</p>
      <div className="post-game-actions">
        <Link className="primary-button" href={`/app?${setup}`}>שחק שוב</Link>
        <button className="secondary-button" type="button" onClick={onReview}>צפה במהלכים</button>
        <button className="secondary-button" type="button" disabled={shareBusy} onClick={() => void shareRecap()}>
          {shareBusy ? "מכינים…" : "שתף סיכום"}
        </button>
        <Link className="quiet-button" href="/">חזרה למשחקים</Link>
      </div>
      {recapUrl ? <div className="post-game-recap-link">
        <input dir="ltr" aria-label="קישור ציבורי לסיכום" value={recapUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
        <button type="button" disabled={shareBusy} onClick={() => void stopSharing()}>הפסק שיתוף</button>
      </div> : null}
      {shareMessage ? <small className={shareError ? "form-error" : "form-success"} role={shareError ? "alert" : "status"}>{shareMessage}</small> : null}
    </section>
  );
}
