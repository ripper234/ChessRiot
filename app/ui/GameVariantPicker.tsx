"use client";

import { useRef } from "react";
import {
  GAME_VARIANTS,
  gameVariant,
  type GameVariantId,
} from "@/lib/game-variants";

export function GameVariantPicker({
  value,
  disabled,
  onChange,
}: {
  value: GameVariantId;
  disabled: boolean;
  onChange: (variantId: GameVariantId) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = gameVariant(value);
  const classic = GAME_VARIANTS.filter((variant) => variant.group === "classic");
  const miniGames = GAME_VARIANTS.filter((variant) => variant.group === "mini-game");
  const matingSet = GAME_VARIANTS.filter((variant) => variant.group === "mating-set");

  function choose(variantId: GameVariantId) {
    onChange(variantId);
    dialog.current?.close();
  }

  return (
    <>
      <button
        className="variant-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span className="variant-trigger-icon" aria-hidden="true">{selected.icon}</span>
        <span>
          <small>GAME</small>
          <strong>{selected.name}</strong>
          <em>{selected.loadout}</em>
        </span>
        <b>CHANGE</b>
      </button>
      <dialog
        className="variant-dialog"
        ref={dialog}
        aria-labelledby="variant-dialog-title"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="variant-dialog-card">
          <header>
            <div>
              <span className="card-kicker">GAME MENU</span>
              <h2 id="variant-dialog-title">Choose a game</h2>
            </div>
            <button
              className="variant-dialog-close"
              type="button"
              aria-label="Close game menu"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </header>
          <fieldset className="variant-group">
            <legend>Classic</legend>
            <div className="variant-grid">
              {classic.map((variant) => (
                <VariantOption
                  key={variant.id}
                  selected={value === variant.id}
                  variant={variant}
                  onChoose={choose}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="variant-group">
            <legend>Mini Games</legend>
            <div className="variant-grid">
              {miniGames.map((variant) => (
                <VariantOption
                  key={variant.id}
                  selected={value === variant.id}
                  variant={variant}
                  onChoose={choose}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="variant-group">
            <legend>Mating Set</legend>
            <div className="variant-grid">
              {matingSet.map((variant) => (
                <VariantOption
                  key={variant.id}
                  selected={value === variant.id}
                  variant={variant}
                  onChoose={choose}
                />
              ))}
            </div>
          </fieldset>
          <p className="variant-dialog-note">
            Every setup uses normal chess moves. Mating Set challenges are Solo practice:
            you command White and checkmate Riot Bot.
          </p>
        </div>
      </dialog>
    </>
  );
}

function VariantOption({
  variant,
  selected,
  onChoose,
}: {
  variant: (typeof GAME_VARIANTS)[number];
  selected: boolean;
  onChoose: (variantId: GameVariantId) => void;
}) {
  return (
    <label className={`variant-option ${selected ? "selected" : ""}`}>
      <input
        type="radio"
        name="game-variant"
        value={variant.id}
        checked={selected}
        onChange={() => onChoose(variant.id)}
      />
      <span className="variant-option-icon" aria-hidden="true">{variant.icon}</span>
      <span>
        <strong>{variant.name}</strong>
        <small>{variant.loadout}</small>
        <em>{variant.description}</em>
      </span>
      <b aria-hidden="true">{selected ? "✓" : "→"}</b>
    </label>
  );
}
