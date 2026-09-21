import Link from "next/link";
import type { GameSnapshot } from "@/lib/game-types";
import { canPlayPendingOpening } from "@/lib/pending-opening";
import styles from "./PendingInvitation.module.css";

export function PendingInvitation({ game, busy, inviteUrl, inviteShared, onCopy, onPlay }: {
  game: GameSnapshot;
  busy: boolean;
  inviteUrl: string;
  inviteShared: boolean;
  onCopy: () => void;
  onPlay: () => void;
}) {
  if (game.status !== "waiting" || game.you.color !== "w") return null;
  const openingSaved = game.plyCount > 0;
  const direct = Boolean(game.players.black);
  return <section className={styles.card} aria-label="Pending invitation">
    <h2>{openingSaved ? "Opening saved. You can leave now." : direct ? "Challenge sent. You can leave now." : "Share your invite, then come back anytime."}</h2>
    <p>{direct ? <>Your challenge to <bdi dir="auto">@{game.players.black!.name}</bdi> is saved.</> : "Your game is saved in your account."} You do not need to be online together.</p>
    {game.turnPaceDays ? <p className={styles.note}>The {game.turnPaceDays}-day move limit starts when your friend accepts.</p> : null}
    <div className={styles.actions}>
      {!busy ? <Link className="primary-button" href="/">Back to games</Link> : <button className="primary-button" disabled>Saving move…</button>}
      {!direct && inviteUrl ? <button className="secondary-button" type="button" onClick={onCopy}>{inviteShared ? "Copied ✓" : "Copy invite link"}</button> : null}
      {canPlayPendingOpening(game, game.you.color) ? <button className="quiet-button" type="button" disabled={busy} onClick={onPlay}>Play opening move</button> : null}
    </div>
    {!direct && !inviteUrl ? <p className={styles.note}>The private invite link is available on the device where you created this game.</p> : null}
  </section>;
}
