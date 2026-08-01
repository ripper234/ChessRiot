"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  normalizeTheme,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "./themes";

const listeners = new Set<() => void>();
let listening = false;

function currentTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return normalizeTheme(document.documentElement.dataset.theme);
}

function notifyThemeChanged() {
  for (const listener of listeners) listener();
}

function syncStoredTheme(event: StorageEvent) {
  if (event.key !== THEME_STORAGE_KEY) return;
  document.documentElement.dataset.theme = normalizeTheme(event.newValue);
  notifyThemeChanged();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("chessriot:theme-changed", notifyThemeChanged);
    window.addEventListener("storage", syncStoredTheme);
    listening = true;
  }

  return () => {
    listeners.delete(listener);
    if (listening && listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("chessriot:theme-changed", notifyThemeChanged);
      window.removeEventListener("storage", syncStoredTheme);
      listening = false;
    }
  };
}

export function useCurrentTheme(): ThemeId {
  return useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME);
}
