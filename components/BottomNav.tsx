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
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useNavNew } from "@/lib/nav-new";
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
  const navRef = useRef<HTMLElement>(null);
  // 새 글이 올라온 탭에 빨간점 (헤더 NEW 배지와 같은 기준)
  const isNew = useNavNew();

  // 화면 아래 끝의 위치. 사파리 하단 툴바가 펴졌다 접혔다 하면 이 값이 바뀐다.
  const [bottomY, setBottomY] = useState<number | null>(null);

  // 'bottom: 0'으로 두면 사파리가 툴바를 여닫을 때 바를 제멋대로 다시 붙여서
  // 탭을 누를 때마다 바가 위로 튀었다 내려온다.
  // 그래서 위에서부터의 좌표를 직접 계산해 붙인다 —
  // visualViewport는 툴바가 움직이는 매 프레임 알려주므로 튐 없이 따라간다.
  //
  // 홈화면에 추가해 앱으로 실행하면 애초에 툴바가 없다.
  // 그때는 이 계산을 아예 하지 않고 평범하게 바닥에 붙인다.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = navRef.current;
    if (!vv || !el) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if ((window.navigator as { standalone?: boolean }).standalone) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 키보드가 올라오면 보이는 영역이 크게 줄어든다.
        // 이때까지 따라가면 바가 키보드 위로 딸려 올라가므로,
        // 툴바 정도(150px)를 넘게 줄면 계산을 포기하고 바닥에 붙인다.
        const shrink = window.innerHeight - (vv.offsetTop + vv.height);
        setBottomY(shrink > 150 ? null : vv.offsetTop + vv.height - el.offsetHeight);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    // 바 높이(안전영역 포함)가 바뀌면 다시 잰다
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      ro.disconnect();
    };
    // 로그인·경로에 따라 다시 마운트되므로 의존성은 없어도 된다
  }, [loading, user, role, pathname]);

  // 아래로 내리면 바가 자리는 그대로 둔 채 작아지고, 위로 올리면 되돌아온다.
  // 바닥을 기준으로 축소하므로(transform-origin: bottom) 바가 위아래로 움직이지 않는다.
  const [shrunk, setShrunk] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - last;
        // 손가락 떨림·바운스로 방향이 깜빡이지 않게 문턱을 둔다
        if (Math.abs(dy) < 8) return;
        last = y;
        // 맨 위에서는 항상 원래 크기
        setShrunk(y > 48 && dy > 0);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // 로그인 전·승인 대기 중에는 띄우지 않는다
  if (loading || !user || role === "guest") return null;
  if (HIDDEN.some((h) => pathname === h || pathname.startsWith(h + "/"))) return null;

  const idx = activeIndex(pathname);
  const n = TABS.length;

  return (
    <nav
      ref={navRef}
      // 아래 수치는 인스타그램 하단 바를 같은 기기 스크린샷으로 재서 맞춘 값이다.
      //   좌우 여백 28 · 바 높이 66 · 바닥에서 24
      className="pointer-events-none fixed inset-x-0 z-30 px-7 md:hidden"
      style={{
        paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 0.75rem))",
        // 아직 재기 전(첫 프레임·visualViewport 미지원)에는 평범하게 바닥에 붙인다
        ...(bottomY === null
          ? { bottom: 0 }
          : { top: 0, transform: `translate3d(0, ${bottomY}px, 0)`, willChange: "transform" }),
      }}
    >
      {/* 떠 있는 알약 모양 바 — 뒤가 비쳐 보이도록 반투명 + 강한 블러 */}
      <div
        className="pointer-events-auto relative mx-auto flex h-[66px] max-w-md items-center rounded-full border border-white/70 px-1"
        style={{
          background: "rgb(255 255 255 / 0.62)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          boxShadow: "0 8px 30px -6px rgba(16,24,40,0.18), 0 2px 8px -2px rgba(16,24,40,0.08)",
          // 아래로 스크롤 → 바닥에 붙은 채로 62%까지 줄어든다
          transform: shrunk ? "scale(0.62)" : "scale(1)",
          transformOrigin: "bottom center",
          transition: "transform 280ms cubic-bezier(0.32, 0.72, 0.28, 1)",
        }}
      >
        {/* 미끄러지는 회색 알약 — 칸 하나 너비만큼 이동한다 */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 top-1/2 h-[54px] rounded-full bg-slate-900/[0.07]"
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
              className="relative z-10 flex flex-1 flex-col items-center justify-center gap-[3px] py-2"
            >
              {/* 아이콘 + 빨간점 — 점이 아이콘 우상단에 살짝 겹쳐 앉는다 */}
              <span className="relative">
                <Glyph
                  className={`h-6 w-6 transition-colors duration-200 ${
                    on ? "text-slate-900" : "text-slate-400"
                  }`}
                />
                {isNew(href) && !on && (
                  <span
                    aria-label="새 글"
                    className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-red-500 ring-[1.5px] ring-white"
                  />
                )}
              </span>
              {/* 아이콘 아래 이름 — 글자가 줄바꿈되지 않도록 자간을 살짝 좁힌다 */}
              <span
                className={`text-[10px] leading-none tracking-[-0.02em] transition-colors duration-200 ${
                  on ? "font-bold text-slate-900" : "font-semibold text-slate-400"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
