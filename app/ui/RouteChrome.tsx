"use client";

import { useRouter } from "next/navigation";
import { prefetchGame } from "@/lib/game-prefetch";
import { useEffect, useLayoutEffect } from "react";
import {
  DEFAULT_THEME,
  isThemeId,
  THEME_STORAGE_KEY,
} from "@/lib/themes";
import { AppUpdates } from "./AppUpdates";
import { AudioController } from "./AudioController";
import { PerformanceMode } from "./PerformanceMode";

export function RouteChrome() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const navigate = (event: MessageEvent) => {
      if (event.data?.type !== "chessriot:notification-open") return;
      const path = event.data.path;
      if (typeof path !== "string" || !/^\/g\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path)) return;
      if (window.location.pathname === path) window.dispatchEvent(new Event("chessriot:notification-open"));
      else { prefetchGame(path.slice(3)); router.push(path); }
      event.ports[0]?.postMessage({ opened: true });
    };
    navigator.serviceWorker.addEventListener("message", navigate);
    return () => navigator.serviceWorker.removeEventListener("message", navigate);
  }, [router]);
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
      <PerformanceMode />
      <AudioController />
      <AppUpdates />
    </>
  );
}
