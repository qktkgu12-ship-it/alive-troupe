"use client";

// 모바일 하단 내비게이션 (인스타그램 방식)
//
// 선택된 칸 뒤로 회색 알약이 깔리고, 다른 칸을 누르면 그 알약이 미끄러지듯 옮겨간다.
// 알약은 칸마다 하나씩 두는 게 아니라 '하나짜리 알약'을 translateX로 옮기는 방식이라
// 이동이 끊기지 않고 이어진다.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArchiveIcon, BoardIcon, CalendarIcon, FolderIcon, HomeIcon } from "@/components/Icons";

const TABS = [
  { href: "/", label: "홈", Icon: HomeIcon },
  { href: "/schedule", label: "일정", Icon: CalendarIcon },
  { href: "/archive", label: "아카이브", Icon: ArchiveIcon },
  { href: "/audio", label: "자료실", Icon: FolderIcon },
  { href: "/board", label: "게시판", Icon: BoardIcon },
];

/** 현재 경로가 어느 탭에 속하는가 (하위 경로도 그 탭으로 친다) */
function activeIndex(pathname: string): number {
  // 홈은 정확히 일치할 때만 (모든 경로가 '/'로 시작하므로)
  if (pathname === "/") return 0;
  const i = TABS.findIndex(
    (t) => t.href !== "/" && (pathname === t.href || pathname.startsWith(t.href + "/"))
  );
  return i; // 어디에도 없으면 -1 → 알약을 숨긴다
}

export default function BottomNav() {
  const pathname = usePathname();
  const idx = activeIndex(pathname);
  const n = TABS.length;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative mx-auto flex h-14 max-w-md items-center px-1.5">
        {/* 미끄러지는 회색 알약 — 칸 하나 너비만큼 이동한다 */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1.5 top-1/2 h-10 rounded-full bg-surface-strong/70"
          style={{
            width: `calc((100% - 0.75rem) / ${n})`,
            transform: `translate(${idx * 100}%, -50%)`,
            opacity: idx < 0 ? 0 : 1,
            // 살짝 튕기는 느낌 — 끝에서 아주 조금 지나쳤다가 자리를 잡는다
            transition:
              "transform 420ms cubic-bezier(0.34, 1.36, 0.4, 1), opacity 200ms ease",
          }}
        />

        {TABS.map(({ href, label, Icon }, i) => {
          const on = i === idx;
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={on ? "page" : undefined}
              className="relative z-10 grid flex-1 place-items-center py-2"
            >
              <Icon
                className={`h-[26px] w-[26px] transition-colors duration-200 ${
                  on ? "text-slate-900" : "text-slate-400"
                }`}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
