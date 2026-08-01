"use client";

import { useLayoutEffect } from "react";
import {
  DEFAULT_THEME,
  isThemeId,
  THEME_STORAGE_KEY,
} from "@/lib/themes";
import { AppUpdates } from "./AppUpdates";
import { AudioController } from "./AudioController";

export function RouteChrome() {
  useLayoutEffect(() => {
    let theme = DEFAULT_THEME;
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(stored)) theme = stored;
    } catch {
      // The default theme remains available without browser storage.
    }
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <>
      <AudioController />
      <AppUpdates />
    </>
  );
}
