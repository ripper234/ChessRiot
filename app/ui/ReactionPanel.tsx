"use client";

import type { RefObject } from "react";
import {
  POST_GAME_REACTION_KEYS,
  REACTION_PRESETS,
  reactionPreset,
  type PublicReaction,
  type ReactionKey,
} from "@/lib/game-reactions";
import type { Color } from "@/lib/game-types";

interface ReactionPanelProps {
  playerColor: Color;
  whiteName: string;
  blackName: string;
  reactions: PublicReaction[];
  hidden: boolean;
  open: boolean;
  busy: ReactionKey | null;
  message: string;
  postGame: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onToggleHidden: () => void;
  onToggleOpen: () => void;
  onSend: (key: ReactionKey) => void;
}

export function ReactionPanel({
  playerColor,
  whiteName,
  blackName,
  reactions,
  hidden,
  open,
  busy,
  message,
  postGame,
  triggerRef,
  onToggleHidden,
  onToggleOpen,
  onSend,
}: ReactionPanelProps) {
  const presets = postGame
    ? REACTION_PRESETS.filter((preset) =>
      POST_GAME_REACTION_KEYS.some((key) => key === preset.key))
    : REACTION_PRESETS;

  return (
    <section className="side-card reactions-card">
      <div className="side-heading">
        <h2>QUICK REACTIONS</h2>
        <button
          className="reaction-hide"
          type="button"
          aria-pressed={hidden}
          onClick={onToggleHidden}
        >
          {hidden ? "SHOW" : "HIDE"}
        </button>
      </div>
      <p>{postGame
        ? "A 15-minute courtesy window for Good Game or Thanks."
        : "Preset-only and kid-safe. No chat or custom text."}</p>
      <button
        className="reaction-trigger"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="reaction-presets"
        onClick={onToggleOpen}
      >
        <span aria-hidden="true">☺</span>
        {open ? "CLOSE REACTIONS" : "SEND A REACTION"}
      </button>
      {open ? (
        <div id="reaction-presets" className="reaction-grid" role="group" aria-label="Preset reactions">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.key}
              disabled={busy !== null}
              aria-label={`Send ${preset.label.toLowerCase()}`}
              onClick={() => onSend(preset.key)}
            >
              <span aria-hidden="true">{preset.icon}</span>
              <b>{busy === preset.key ? "SENDING…" : preset.label}</b>
            </button>
          ))}
        </div>
      ) : null}
      {message ? <p className="reaction-message" role="status">{message}</p> : null}
      {!hidden && reactions.length > 0 ? (
        <ol className="reaction-history" aria-label="Recent reactions">
          {reactions.slice(-4).reverse().map((reaction) => {
            const preset = reactionPreset(reaction.key);
            const sender = reaction.senderColor === playerColor
              ? "YOU"
              : reaction.senderColor === "w" ? whiteName : blackName;
            return (
              <li key={reaction.id}>
                <span aria-hidden="true">{preset.icon}</span>
                <b>{sender}</b>
                <small>{preset.label}</small>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
