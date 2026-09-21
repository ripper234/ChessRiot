"use client";

import { useLanguage } from "./LanguageProvider";
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
  const { t } = useLanguage();
  if (game.status !== "waiting" || game.you.color !== "w") return null;
  const openingSaved = game.plyCount > 0;
  const direct = Boolean(game.players.black);
  return <section className={styles.card} aria-label={t("Pending invitation")}>
    <h2>{openingSaved ? t("Opening saved. You can leave now.") : direct ? t("Challenge sent. You can leave now.") : t("Share your invite, then come back anytime.")}</h2>
    <p>{direct ? <>{t("Your challenge to")}{" "}<bdi dir="auto">@{game.players.black!.name}</bdi>{" "}{t("is saved.")}</> : t("Your game is saved in your account.")}{" "}{t("You do not need to be online together.")}</p>
    {game.turnPaceDays ? <p className={styles.note}>{t("The ${days}-day move limit starts when your friend accepts.", { days: game.turnPaceDays })}</p> : null}
    <div className={styles.actions}>
      {!busy ? <Link className="primary-button" href="/">{t("Back to games")}</Link> : <button className="primary-button" disabled>{t("Saving…")}</button>}
      {!direct && inviteUrl ? <button className="secondary-button" type="button" onClick={onCopy}>{inviteShared ? t("Copied ✓") : t("Copy invite link")}</button> : null}
      {canPlayPendingOpening(game, game.you.color) ? <button className="quiet-button" type="button" disabled={busy} onClick={onPlay}>{t("Play opening move")}</button> : null}
    </div>
    {!direct && !inviteUrl ? <p className={styles.note}>{t("The private invite link is available on the device where you created this game.")}</p> : null}
  </section>;
}
