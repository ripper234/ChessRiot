"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AUTH_SESSION_CHANGED_EVENT, AUTH_SESSION_INVALIDATED_EVENT, publishAuthSessionChanged, readAuthSession } from "@/lib/auth-session-client";
import { translate, type Locale } from "@/lib/locale";

const LanguageContext = createContext({
  locale: "en" as Locale,
  dir: "ltr" as "ltr" | "rtl",
  saving: false,
  saveLocale: async (locale: Locale): Promise<boolean> => { void locale; return false; },
  t: (message: string, values: Record<string, unknown> = {}) => translate("en", message, values),
});
interface LanguageSession { signedIn?: boolean; account?: { username?: string; locale?: Locale } | null }

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [saving, setSaving] = useState(false);
  const owner = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const refresh = async () => {
      const current = ++generation.current;
      try {
        const { response, data } = await readAuthSession<LanguageSession>();
        if (current !== generation.current || !response.ok) return;
        owner.current = data?.signedIn ? data.account?.username ?? null : null;
        setLocale(owner.current && data?.account?.locale === "he" ? "he" : "en");
      } catch { /* Keep the last verified preference during temporary network loss. */ }
    };
    const invalidated = () => { owner.current = null; setLocale("en"); void refresh(); };
    void refresh();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refresh);
    window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, invalidated);
    return () => {
      generation.current += 1;
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, invalidated);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
  }, [locale]);
  const saveLocale = useCallback(async (next: Locale) => {
    const account = owner.current;
    if (!account || saving) return false;
    setSaving(true);
    try {
      const response = await fetch("/api/me/preferences", {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next, expectedUsername: account }),
      });
      if (!response.ok || account !== owner.current) return false;
      setLocale(next);
      publishAuthSessionChanged(true);
      return true;
    } catch { return false; }
    finally { setSaving(false); }
  }, [saving]);
  const t = useCallback((message: string, values: Record<string, unknown> = {}) => translate(locale, message, values), [locale]);
  return <LanguageContext.Provider value={{ locale, dir: locale === "he" ? "rtl" : "ltr", saving, saveLocale, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }
