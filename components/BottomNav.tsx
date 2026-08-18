"use client";

// 모바일 하단 내비게이션 (인스타그램 방식)
//
// 선택된 칸 뒤로 회색 알약이 깔리고, 다른 칸을 누르면 그 알약이 미끄러지듯 옮겨간다.
// 알약은 칸마다 하나씩 두는 게 아니라 '하나짜리 알약'을 translateX로 옮기는 방식이라
// 이동이 끊기지 않고 이어진다.
//
// 이 컴포넌트는 반드시 루트 레이아웃에 두어야 한다.
// 페이지 안(AppShell 아래)에 두면 화면을 옮길 때마다 다시 만들어져서
// 알약이 미끄러지지 않고 새 위치에 툭 나타난다.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  ArchiveIcon,
  ArchiveIconSolid,
  BoardIcon,
  BoardIconSolid,
  CalendarIcon,
  CalendarIconSolid,
  FolderIcon,
  FolderIconSolid,
  HomeIcon,
  HomeIconSolid,
} from "@/components/Icons";

const TABS = [
  { href: "/", label: "홈", Icon: HomeIcon, Solid: HomeIconSolid },
  { href: "/schedule", label: "일정", Icon: CalendarIcon, Solid: CalendarIconSolid },
  { href: "/archive", label: "아카이브", Icon: ArchiveIcon, Solid: ArchiveIconSolid },
  { href: "/audio", label: "자료실", Icon: FolderIcon, Solid: FolderIconSolid },
  { href: "/board", label: "게시판", Icon: BoardIcon, Solid: BoardIconSolid },
];

// 내비게이션을 감출 화면 (로그인·승인 대기 등)
const HIDDEN = ["/login", "/pending"];

/** 현재 경로가 어느 탭에 속하는가 (하위 경로도 그 탭으로 친다) */
function activeIndex(pathname: string): number {
  // 홈은 정확히 일치할 때만 (모든 경로가 '/'로 시작하므로)
  if (pathname === "/") return 0;
  return TABS.findIndex(
    (t) => t.href !== "/" && (pathname === t.href || pathname.startsWith(t.href + "/"))
  ); // 어디에도 없으면 -1 → 알약을 숨긴다
}

export default function BottomNav() {
  const pathname = usePathname();
  const { user, role, loading } = useAuth();

  // 로그인 전·승인 대기 중에는 띄우지 않는다
  if (loading || !user || role === "guest") return null;
  if (HIDDEN.some((h) => pathname === h || pathname.startsWith(h + "/"))) return null;

  const idx = activeIndex(pathname);
  const n = TABS.length;

  return (
    <nav
      // 아래 수치는 인스타그램 하단 바를 같은 기기 스크린샷으로 재서 맞춘 값이다.
      //   좌우 여백 28 · 바 높이 52 · 아이콘 중심 간격 65 · 바닥에서 30
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-7 md:hidden"
      style={{ paddingBottom: "max(0.875rem, calc(env(safe-area-inset-bottom) - 0.25rem))" }}
    >
      {/* 떠 있는 알약 모양 바 — 뒤가 비쳐 보이도록 반투명 + 강한 블러 */}
      <div
        className="pointer-events-auto relative mx-auto flex h-[52px] max-w-md items-center rounded-full border border-white/70 px-1"
        style={{
          background: "rgb(255 255 255 / 0.62)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          boxShadow: "0 8px 30px -6px rgba(16,24,40,0.18), 0 2px 8px -2px rgba(16,24,40,0.08)",
        }}
      >
        {/* 미끄러지는 회색 알약 — 칸 하나 너비만큼 이동한다 */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 top-1/2 h-[44px] rounded-full bg-slate-900/[0.07]"
          style={{
            width: `calc((100% - 0.5rem) / ${n})`,
            transform: `translate(${idx * 100}%, -50%)`,
            opacity: idx < 0 ? 0 : 1,
            // 살짝 튕기는 느낌 — 끝에서 아주 조금 지나쳤다가 자리를 잡는다
            transition:
              "transform 420ms cubic-bezier(0.34, 1.36, 0.4, 1), opacity 200ms ease",
          }}
        />

        {TABS.map(({ href, label, Icon, Solid }, i) => {
          const on = i === idx;
          const Glyph = on ? Solid : Icon;
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={on ? "page" : undefined}
              className="relative z-10 grid flex-1 place-items-center py-2"
            >
              {/* 우리 글리프는 24 틀 안에서 3~21만 쓰므로, 인스타그램과 같은
                  광학 크기(약 21)를 내려면 28로 그려야 한다.
                  선 굵기는 CSS로 올린다 (속성보다 CSS가 우선한다) */}
              <Glyph
                className={`h-7 w-7 transition-colors duration-200 [stroke-width:2] ${
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
