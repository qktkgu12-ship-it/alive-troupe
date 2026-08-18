"use client";

// 내비게이션 '새 글' 표시 — PC 헤더의 NEW 배지와 하단 바의 빨간점이
// 같은 상태를 본다.
//
// 두 컴포넌트는 서로 다른 곳(AppShell / 루트 레이아웃)에 마운트돼 있어서
// 각자 localStorage를 읽으면 한쪽이 '봤음'으로 기록해도 다른 쪽이 모른다.
// 그래서 아주 작은 공유 저장소를 하나 두고 둘 다 여기를 구독한다.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useNotifications } from "./notifications-context";

const SEEN_KEY = "alive-nav-seen";

// 알림 href → 내비 섹션
const SECTIONS = ["/schedule", "/archive", "/audio", "/board", "/members", "/admin"];

export function sectionOf(path: string): string | null {
  for (const base of SECTIONS) {
    if (path === base || path.startsWith(base + "/") || path.startsWith(base + "?")) return base;
  }
  return null;
}

type Seen = Record<string, number>;

// 서버 렌더링과 첫 하이드레이션에서 쓰는 고정 빈 값
const EMPTY: Seen = {};

let cache: Seen | null = null;
const listeners = new Set<() => void>();

// getSnapshot은 렌더 중에 불리므로 같은 값이면 같은 참조를 돌려줘야 한다
function snapshot(): Seen {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") as Seen;
  } catch {
    cache = {};
  }
  return cache;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 그 섹션을 방금 봤다고 기록 → 배지·빨간점이 사라진다 */
export function markSeen(section: string) {
  const next = { ...snapshot(), [section]: Date.now() };
  cache = next;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* 무시 */
  }
  listeners.forEach((fn) => fn());
}

/**
 * `isNew("/board")` 처럼 쓰면 그 섹션에 안 본 새 항목이 있는지 알려준다.
 * 판단 기준은 알림 데이터(가장 최근 항목 시각) vs 마지막으로 본 시각.
 */
export function useNavNew() {
  const { items } = useNotifications();
  const seen = useSyncExternalStore(subscribe, snapshot, () => EMPTY);

  const latest = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of items) {
      const sec = sectionOf(n.href);
      if (sec) m[sec] = Math.max(m[sec] ?? 0, n.time);
    }
    return m;
  }, [items]);

  return useCallback(
    (href: string) => {
      const t = latest[href];
      return !!t && t > (seen[href] ?? 0);
    },
    [latest, seen]
  );
}
