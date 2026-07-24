"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_THEME,
  isThemeId,
  THEMES,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "@/lib/themes";

export function ThemePicker() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const activeTheme = document.documentElement.dataset.theme;
    if (isThemeId(activeTheme)) setSelectedTheme(activeTheme);

    const syncTheme = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY || !isThemeId(event.newValue)) return;
      document.documentElement.dataset.theme = event.newValue;
      setSelectedTheme(event.newValue);
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function showPicker() {
    const activeTheme = document.documentElement.dataset.theme;
    if (isThemeId(activeTheme)) setSelectedTheme(activeTheme);
    setOpen(true);
    dialogRef.current?.showModal();
  }

  function closePicker() {
    dialogRef.current?.close();
  }

  function choose(theme: ThemeId) {
    document.documentElement.setAttribute("data-theme", theme);
    setSelectedTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The theme still applies to this tab when browser storage is blocked.
    }
    closePicker();
  }

  return (
    <>
      <button
        className="theme-launcher"
        type="button"
        ref={triggerRef}
        aria-label="Choose visual theme"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose visual theme"
        onClick={showPicker}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <dialog
        className="theme-dialog"
        ref={dialogRef}
        aria-labelledby="theme-dialog-title"
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePicker();
        }}
      >
        <div className="theme-dialog-card">
          <div className="theme-dialog-heading">
            <div>
              <p className="eyebrow"><span />LOOK &amp; FEEL</p>
              <h2 id="theme-dialog-title">Choose a theme</h2>
            </div>
            <button type="button" onClick={closePicker} aria-label="Close theme picker">×</button>
          </div>
          <fieldset className="theme-grid">
            <legend className="visually-hidden">Visual theme</legend>
            {THEMES.map((theme) => (
              <label
                className="theme-option"
                data-selected={selectedTheme === theme.id ? "true" : "false"}
                key={theme.id}
              >
                <input
                  type="radio"
                  name="visual-theme"
                  value={theme.id}
                  checked={selectedTheme === theme.id}
                  aria-label={`${theme.name}: ${theme.description}`}
                  onChange={() => choose(theme.id)}
                />
                <span className="theme-preview" aria-hidden="true">
                  {theme.preview.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <strong>{theme.name}</strong>
                <small>{theme.description}</small>
                <b aria-hidden="true">✓</b>
              </label>
            ))}
          </fieldset>
          <p className="theme-note">
            Original palettes only. No third-party artwork, logos, or game assets.
          </p>
        </div>
      </dialog>
    </>
  );
}
