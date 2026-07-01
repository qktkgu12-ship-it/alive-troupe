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
import { derivePalette, hexToRgbTriplet, readableTextColor } from "./utils";

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

// 저장된 강조색(파이어스토어 settings.accentColor)을 CSS 변수로 적용.
// 관리자 색 선택 UI는 없앴지만, 기존에 저장된 극단 색은 그대로 적용된다.
function applyAccent(hex: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const accent = hexToRgbTriplet(hex);
  const accentFg = readableTextColor(hex);
  const { accentDeep } = derivePalette(hex);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-fg", accentFg);
  root.style.setProperty("--accent-2", accentDeep);
  // 다음 방문 때 깜빡임 없이 바로 칠하도록 캐시 (layout.tsx 인라인 스크립트가 읽음)
  try {
    localStorage.setItem("alive-accent", accent);
    localStorage.setItem("alive-accent-fg", accentFg);
    localStorage.setItem("alive-accent-2", accentDeep);
  } catch {
    /* 무시 */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 캐시가 없으면(최초 방문) 기본색을 먼저 적용해 둔다.
    try {
      if (!localStorage.getItem("alive-accent")) applyAccent(DEFAULT_SETTINGS.accentColor);
    } catch {
      applyAccent(DEFAULT_SETTINGS.accentColor);
    }
    // 설정 문서 실시간 구독 → 저장된 극단 색·이름·팀 등을 반영
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
