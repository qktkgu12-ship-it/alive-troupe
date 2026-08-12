"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { type AppNotification, type NotifType } from "@/lib/notifications";
import { relativeTime } from "@/lib/utils";
import {
  ArchiveIcon,
  BellIcon,
  CalendarIcon,
  CommentIcon,
  HeartIcon,
  MegaphoneIcon,
  MusicIcon,
  UserPlusIcon,
  XIcon,
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

/**
 * 헤더의 알림 버튼 + 오른쪽에서 슬라이드되는 알림 패널.
 * (예전에는 화면 우하단 플로팅 버튼이었음)
 */
export default function NotificationBell() {
  const { user, profile, role } = useAuth();
  const { items, loading, refresh } = useNotifications();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [reads, setReads] = useState<Record<string, number>>({});
  const initedReads = useRef(false);
  // 헤더에 backdrop-blur가 있어 fixed 자식이 헤더 안에 갇혀 잘림 → body로 포털
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isMember = role === "member" || role === "admin";

  // 읽음 상태 초기화 (프로필 로드 시 한 번)
  useEffect(() => {
    if (profile && !initedReads.current) {
      setReads(profile.notifReads ?? {});
      initedReads.current = true;
    }
  }, [profile]);

  // 패널 열려 있을 때 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
      <button
        onClick={() => {
          const willOpen = !open;
          setOpen(willOpen);
          if (willOpen) refresh(true);
        }}
        aria-label="알림"
        className="relative grid h-10 w-10 place-items-center rounded-full text-slate-700 transition hover:bg-slate-100"
      >
        <BellIcon className={`h-[22px] w-[22px] ${unreadCount > 0 ? "animate-bell" : ""}`} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          <>
            {/* 오버레이 */}
            <div
              onClick={() => setOpen(false)}
              className={`fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${
                open ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            />

            {/* 오른쪽 슬라이드 패널 */}
            <aside
              className={`fixed right-0 top-0 z-[61] flex h-full w-[86%] max-w-[380px] flex-col bg-white shadow-2xl transition-transform duration-300 ${
                open ? "translate-x-0" : "translate-x-full"
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
                <p className="text-lg font-bold text-slate-900">알림</p>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={markAll} className="rounded-lg px-2 py-1 text-xs font-semibold text-accent transition hover:bg-accent-soft">
                      모두 읽음
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="닫기"
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
                  >
                    <XIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading && visibleItems.length === 0 ? (
                  <p className="py-16 text-center text-sm text-slate-400">불러오는 중…</p>
                ) : visibleItems.length === 0 ? (
                  <p className="py-16 text-center text-sm text-slate-400">새로운 알림이 없어요.</p>
                ) : (
                  visibleItems.map((n) => {
                    const Icon = ICON[n.type];
                    return (
                      <button
                        key={n.id}
                        onClick={() => openItem(n)}
                        className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3.5 text-left transition hover:bg-slate-50"
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
          </aside>
        </>,
        document.body
      )}
    </>
  );
}
