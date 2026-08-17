"use client";

// 알림을 앱 전체에서 '한 번만' 불러와 공유한다.
// (알림벨 + 내비 NEW 배지가 각자 조회하면 중복이라, 상위에서 한 번 조회해 공유)
// 읽음 상태(reads)도 여기서 함께 관리 — 페이지마다 새로 마운트되는 NotificationBell에
// 로컬로 두면, 다른 페이지로 이동했을 때 '모두 읽음'이 초기화되어 다시 뜨는 문제가 있었음.

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
  reads: Record<string, number>;
  markRead: (id: string) => void;
  markAll: () => void;
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

  // 최초 1회 + 3분 간격 백그라운드 갱신.
  // 알림은 '지금 보는 화면'에 필요한 데이터가 아니므로, 브라우저가 한가해질 때까지 미룬다.
  // (바로 쏘면 페이지 자체 조회와 커넥션을 두고 경쟁해서 첫 화면이 늦게 뜬다)
  useEffect(() => {
    let idleId: number | undefined;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (ric) idleId = ric(() => refresh(), { timeout: 3000 });
    else idleId = window.setTimeout(() => refresh(), 1200);

    const t = setInterval(() => refresh(), 180_000);
    return () => {
      clearInterval(t);
      const cic = (window as unknown as {
        cancelIdleCallback?: (id: number) => void;
      }).cancelIdleCallback;
      if (idleId != null) (ric && cic ? cic : window.clearTimeout)(idleId);
    };
  }, [refresh]);

  // 읽음 상태 — 이 Provider는 루트 레이아웃에서 한 번만 마운트되므로,
  // 페이지를 이동해도 초기화되지 않고 계속 유지됨
  const [reads, setReads] = useState<Record<string, number>>({});
  const initedReads = useRef(false);
  useEffect(() => {
    if (profile && !initedReads.current) {
      setReads(profile.notifReads ?? {});
      initedReads.current = true;
    }
  }, [profile]);

  function persistReads(next: Record<string, number>) {
    setReads(next); // 낙관적 갱신
    // 가지치기 없이 전체 저장 — ID 기준 필터 시 items가 비어있으면 reads가 날아가는 버그 방지
    if (user) updateDoc(doc(db, "users", user.uid), { notifReads: next }).catch(() => {});
  }

  function markRead(id: string) {
    if (reads[id]) return;
    persistReads({ ...reads, [id]: Date.now() });
  }

  function markAll() {
    const next = { ...reads };
    for (const n of items) next[n.id] = Date.now();
    persistReads(next);
  }

  return (
    <Ctx.Provider value={{ items, loading, refresh, reads, markRead, markAll }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
