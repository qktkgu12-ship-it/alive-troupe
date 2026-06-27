"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { fetchNotifications, type AppNotification, type NotifType } from "@/lib/notifications";
import { relativeTime } from "@/lib/utils";
import {
  ArchiveIcon,
  CalendarIcon,
  CommentIcon,
  HeartIcon,
  MegaphoneIcon,
  MusicIcon,
  UserPlusIcon,
} from "@/components/Icons";

const ICON: Record<NotifType, React.FC<{ className?: string }>> = {
  event: CalendarIcon,
  archive: ArchiveIcon,
  audio: MusicIcon,
  like: HeartIcon,
  comment: CommentIcon,
  notice: MegaphoneIcon,
  approval: UserPlusIcon,
};

function BellIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NotificationBell() {
  const { user, profile, role } = useAuth();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [reads, setReads] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const sinceRef = useRef<number | null>(null);
  const lastFetch = useRef(0);
  const initedReads = useRef(false);

  const isMember = role === "member" || role === "admin";

  // 읽음 상태 초기화 (프로필 로드 시 한 번)
  useEffect(() => {
    if (profile && !initedReads.current) {
      setReads(profile.notifReads ?? {});
      initedReads.current = true;
    }
  }, [profile]);

  const refresh = useCallback(
    async (force = false) => {
      if (!user || !isMember) return;
      if (!force && Date.now() - lastFetch.current < 30_000) return; // 30초 쓰로틀
      lastFetch.current = Date.now();

      // 알림 기준 시각(since) 보장: 처음이면 '지금'으로 설정 → 과거 알림 폭주 방지
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

  // 최초 1회 + 3분 간격 백그라운드 갱신 (페이지 이동마다 조회하지 않아 읽기 횟수 절약)
  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), 180_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!user || !isMember) return null;

  // 클릭(읽음)한 알림은 목록에서 사라짐 → 안 읽은 것만 표시
  const visibleItems = items.filter((n) => !reads[n.id]);
  const unreadCount = visibleItems.length;

  function persistReads(next: Record<string, number>) {
    setReads(next); // 낙관적 갱신
    // 현재 목록에 있는 id만 남겨 저장 용량 가지치기
    const ids = new Set(items.map((i) => i.id));
    const valid: Record<string, number> = {};
    for (const k in next) if (ids.has(k)) valid[k] = next[k];
    if (user) updateDoc(doc(db, "users", user.uid), { notifReads: valid }).catch(() => {});
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

  function openItem(n: AppNotification) {
    markRead(n.id);
    setOpen(false);
    router.push(n.href);
  }

  return (
    <>
      {/* 바깥 클릭 시 닫기 */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <div className="fixed bottom-5 right-5 z-50">
        {open && (
          <div className="absolute bottom-16 right-0 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="font-bold text-slate-900">알림</p>
              {unreadCount > 0 && (
                <button onClick={markAll} className="text-xs font-medium text-accent">
                  모두 읽음
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {loading && visibleItems.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">불러오는 중…</p>
              ) : visibleItems.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">새로운 알림이 없어요.</p>
              ) : (
                visibleItems.map((n) => {
                  const Icon = ICON[n.type];
                  return (
                    <button
                      key={n.id}
                      onClick={() => openItem(n)}
                      className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                        {n.sub && <span className="mt-0.5 block truncate text-xs text-slate-500">{n.sub}</span>}
                        <span className="mt-0.5 block text-[11px] text-slate-400">{relativeTime(n.time)}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            const willOpen = !open;
            setOpen(willOpen);
            if (willOpen) refresh(true);
          }}
          aria-label="알림"
          className="bg-accent-gradient relative grid h-14 w-14 place-items-center rounded-full text-accent-fg shadow-lg shadow-accent/30 transition hover:brightness-110 active:scale-95"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
