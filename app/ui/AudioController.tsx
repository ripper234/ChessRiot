"use client";

import { useEffect, useState } from "react";
import {
  AUDIO_PREFERENCES_EVENT,
  readMusicPreference,
  startThemeMusic,
  unlockGameSounds,
  type AudioPreferences,
} from "@/lib/game-sounds";
import { DEFAULT_THEME, normalizeTheme, type ThemeId } from "@/lib/themes";

export function AudioController() {
  const [musicOn, setMusicOn] = useState(true);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMusicOn(readMusicPreference());
    setTheme(normalizeTheme(document.documentElement.dataset.theme));
    setHydrated(true);
    const syncAudio = (event: Event) => {
      setMusicOn((event as CustomEvent<AudioPreferences>).detail.musicOn);
    };
    const syncTheme = (event: Event) => {
      setTheme(normalizeTheme((event as CustomEvent<string>).detail));
    };
    const syncStorage = () => setMusicOn(readMusicPreference());
    window.addEventListener(AUDIO_PREFERENCES_EVENT, syncAudio);
    window.addEventListener("chessriot:theme-changed", syncTheme);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(AUDIO_PREFERENCES_EVENT, syncAudio);
      window.removeEventListener("chessriot:theme-changed", syncTheme);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !musicOn) return;
    let stopMusic = () => {};
    let started = false;
    let starting = false;
    let disposed = false;
    const start = async () => {
      if (started || starting || document.visibilityState !== "visible") return;
      starting = true;
      try {
        if (!await unlockGameSounds()) return;
        if (disposed || started || document.visibilityState !== "visible") return;
        started = true;
        stopMusic = startThemeMusic(theme);
      } finally {
        starting = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopMusic();
        started = false;
      } else {
        void start();
      }
    };
    void start();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      stopMusic();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hydrated, musicOn, theme]);

  return null;
}
