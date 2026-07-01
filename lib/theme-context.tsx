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

const DEFAULT_SETTINGS: SiteSettings = {
  troupeName: "ALIVE 얼라이브",
  currentProduction: "",
  currentProductionId: "",
  resourceCategories: ["음원", "기타"],
  boardCategories: ["자유게시판", "의상·소품", "무대"],
  teams: [], // 기본: 팀 없음(팀 기능 off). 관리에서 추가하면 켜짐
  accentColor: "#7c3aed", // 기본: 보라
};

interface ThemeState {
  settings: SiteSettings;
  loading: boolean;
  saveSettings: (s: Partial<SiteSettings>) => Promise<void>;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const SETTINGS_DOC = doc(db, "settings", "site");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 강조색은 코드에 고정(globals.css). 여기선 극단명·팀·카테고리 등 설정만 구독.
    const unsub = onSnapshot(
      SETTINGS_DOC,
      (snap) => {
        if (snap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as SiteSettings) });
        } else {
          setSettings(DEFAULT_SETTINGS);
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
