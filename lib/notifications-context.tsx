"use client";

// 알림을 앱 전체에서 '한 번만' 불러와 공유한다.
// (알림벨 + 내비 NEW 배지가 각자 조회하면 중복이라, 상위에서 한 번 조회해 공유)

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./auth-context";
import { fetchNotifications, type AppNotification } from "./notifications";

interface NotifState {
  items: AppNotification[];
  loading: boolean;
  refresh: (force?: boolean) => void;
}

const Ctx = createContext<NotifState | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, profile, role } = useAuth();
  const isMember = role === "member" || role === "admin";

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const sinceRef = useRef<number | null>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(
    async (force = false) => {
      if (!user || !isMember) return;
      if (!force && Date.now() - lastFetch.current < 30_000) return; // 30초 쓰로틀
      lastFetch.current = Date.now();

      // 알림 기준 시각(since): 처음이면 '지금'으로 설정 → 과거 알림 폭주 방지
      let since = sinceRef.current ?? profile?.notifSince ?? null;
      if (since == null) {
        since = Date.now();
        updateDoc(doc(db, "users", user.uid), { notifSince: since }).catch(() => {});
      }
      sinceRef.current = since;

      setLoading(true);
      try {
        const list = await fetchNotifications({ uid: user.uid, isAdmin: role === "admin", since });
        setItems(list);
      } finally {
        setLoading(false);
      }
    },
    [user, isMember, role, profile?.notifSince]
  );

  // 최초 1회 + 3분 간격 백그라운드 갱신
  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), 180_000);
    return () => clearInterval(t);
  }, [refresh]);

  return <Ctx.Provider value={{ items, loading, refresh }}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
