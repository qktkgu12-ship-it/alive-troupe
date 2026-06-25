"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { SiteSettings } from "./types";
import { hexToRgbTriplet, readableTextColor } from "./utils";

const DEFAULT_SETTINGS: SiteSettings = {
  troupeName: "ALIVE 얼라이브",
  currentProduction: "",
  accentColor: "#7c3aed", // 기본: 보라
};

interface ThemeState {
  settings: SiteSettings;
  loading: boolean;
  saveSettings: (s: Partial<SiteSettings>) => Promise<void>;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const SETTINGS_DOC = doc(db, "settings", "site");

function applyAccent(hex: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent", hexToRgbTriplet(hex));
  root.style.setProperty("--accent-fg", readableTextColor(hex));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    applyAccent(DEFAULT_SETTINGS.accentColor);
    // 설정 문서를 실시간 구독 → 관리자가 색을 바꾸면 모두에게 즉시 반영
    const unsub = onSnapshot(
      SETTINGS_DOC,
      (snap) => {
        if (snap.exists()) {
          const data = { ...DEFAULT_SETTINGS, ...(snap.data() as SiteSettings) };
          setSettings(data);
          applyAccent(data.accentColor);
        } else {
          setSettings(DEFAULT_SETTINGS);
          applyAccent(DEFAULT_SETTINGS.accentColor);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  async function saveSettings(s: Partial<SiteSettings>) {
    await setDoc(SETTINGS_DOC, { ...settings, ...s }, { merge: true });
  }

  return (
    <ThemeContext.Provider value={{ settings, loading, saveSettings }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
