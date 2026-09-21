import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GameSnapshot, Termination } from "@/lib/game-types";
import { isolateText } from "@/lib/bidi";

export function recapShareTitle(game: Pick<GameSnapshot, "players">): string {
  return `${isolateText(game.players.white.name)} vs ${isolateText(game.players.black?.name ?? "Riot Bot")} on ChessRiot`;
}

const REASON_LABELS: Record<Termination, string> = {
  checkmate: "Checkmate",
  resignation: "Resignation",
  stalemate: "Stalemate",
  insufficient_material: "Insufficient material",
  threefold_repetition: "Threefold repetition",
  fivefold_repetition: "Fivefold repetition",
  fifty_move: "50-move rule",
  seventy_five_move: "75-move rule",
  cancelled: "Game cancelled",
  timeout: "Time ran out",
  draw: "Draw",
};

function outcomeHeading(game: GameSnapshot): string {
  if (game.outcome?.reason === "cancelled") return "Game cancelled";
  if (!game.outcome || game.outcome.winner === null) return "The game is a draw";
  return game.outcome.winner === game.you.color ? "You won" : "You lost";
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
        throw new Error("Could not create a game recap link.");
      }
      setRecapUrl(payload.url);
      const data = {
        title: recapShareTitle(game),
        text: "Replay this completed ChessRiot game.",
        url: payload.url,
      };
      if (typeof navigator.share === "function") {
        try {
          await navigator.share(data);
          setShareMessage("Recap shared. Anyone with the link can see player names and moves.");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setShareMessage("The recap link is ready.");
            return;
          }
        }
      }
      await navigator.clipboard.writeText(payload.url);
      setShareMessage("Recap link copied. Anyone with the link can see player names and moves.");
    } catch {
      setShareError(true);
      setShareMessage("Could not create a game recap link.");
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
      setShareMessage("The recap link is no longer active.");
    } catch {
      setShareError(true);
      setShareMessage("Could not make the recap private. Try again.");
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <section className="post-game-panel" dir="ltr" aria-labelledby="post-game-title" role="region">
      <button className="post-game-dismiss" type="button" onClick={onDismiss} aria-label="Close game result">×</button>
      <small>Final result</small>
      <h2 id="post-game-title" ref={titleRef} tabIndex={-1}>{outcomeHeading(game)}</h2>
      <p>{game.outcome ? REASON_LABELS[game.outcome.reason] : "Game over"}</p>
      <div className="post-game-actions">
        <Link className="primary-button" href={`/app?${setup}`}>Play again</Link>
        <button className="secondary-button" type="button" onClick={onReview}>Review moves</button>
        <button className="secondary-button" type="button" disabled={shareBusy} onClick={() => void shareRecap()}>
          {shareBusy ? "Preparing…" : "Share recap"}
        </button>
        <Link className="quiet-button" href="/">Back to games</Link>
      </div>
      {recapUrl ? <div className="post-game-recap-link">
        <input dir="ltr" aria-label="Public recap link" value={recapUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
        <button type="button" disabled={shareBusy} onClick={() => void stopSharing()}>Stop sharing</button>
      </div> : null}
      {shareMessage ? <small className={shareError ? "form-error" : "form-success"} role={shareError ? "alert" : "status"}>{shareMessage}</small> : null}
    </section>
  );
}
