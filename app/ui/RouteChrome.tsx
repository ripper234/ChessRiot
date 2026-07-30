"use client";

import Link from "next/link";
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_THEME,
  isThemeId,
  THEME_STORAGE_KEY,
} from "@/lib/themes";
import { APP_VERSION } from "@/lib/version";
import { AppUpdates } from "./AppUpdates";
import { FeedbackButton } from "./FeedbackButton";
import { ThemePicker } from "./ThemePicker";

export function RouteChrome() {
  const pathname = usePathname();
  const activeGame = pathname.startsWith("/g/");
  const publicHome = pathname === "/";

  useLayoutEffect(() => {
    if (!activeGame) {
      document.documentElement.removeAttribute("data-theme");
      return;
    }
    let theme = DEFAULT_THEME;
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(stored)) theme = stored;
    } catch {
      // The default game theme remains available without browser storage.
    }
    document.documentElement.dataset.theme = theme;
  }, [activeGame]);

  if (publicHome) return null;

  return (
    <>
      <AppUpdates />
      {activeGame ? <ThemePicker /> : null}
      {!activeGame ? <Link className="global-version" href="/changelog">v{APP_VERSION}</Link> : null}
      <FeedbackButton />
    </>
  );
}
