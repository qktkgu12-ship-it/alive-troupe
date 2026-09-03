"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { AdminIcon, MembersIcon, SearchIcon, XIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import NotificationBell from "@/components/NotificationBell";
import BottomSheet from "@/components/BottomSheet";
import { markSeen, sectionOf, useNavNew } from "@/lib/nav-new";
import PushOnboard from "@/components/PushOnboard";

const NAV = [
  { href: "/", label: "홈", admin: false },
  { href: "/schedule", label: "일정", admin: false },
  { href: "/archive", label: "아카이브", admin: false },
  { href: "/audio", label: "자료실", admin: false },
  { href: "/board", label: "게시판", admin: false },
  { href: "/members", label: "멤버", admin: false },
  { href: "/admin", label: "관리", admin: true },
];

// 헤더의 '+' 등록 메뉴는 걷어냈다 (그 자리는 프로필이 쓴다).
// 다섯 가지 등록은 모두 각 페이지에 자기 버튼이 있어 기능이 사라지진 않는다:
//   글쓰기 → 게시판 · 영상 등록 → 아카이브 · 자료 추가 → 자료실
//   일정 등록/예약 → 일정 확정 탭 · 일정방 만들기 → 일정 잡기 탭

function NewBadge() {
  return (
    <span className="ml-1.5 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none tracking-wide text-accent-fg">
      NEW
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // 헤더: 검색 모드 / 프로필 메뉴
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const links = NAV.filter((n) => !n.admin || role === "admin");
  // 하단 바에 자리가 없는 메뉴들 — 프로필 시트로 들어간다
  const menuLinks = [
    { href: "/members", label: "멤버", icon: MembersIcon, admin: false },
    { href: "/admin", label: "관리", icon: AdminIcon, admin: true },
  ].filter((m) => !m.admin || role === "admin");
  const { settings } = useTheme();

  // 검색 모드로 들어가면 입력창에 포커스
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    setSearchOpen(false);
    setTerm("");
    router.push(`/search?q=${encodeURIComponent(t)}`);
  }

  // NEW 판단은 하단 바 빨간점과 같은 저장소를 쓴다
  const isNew = useNavNew();

  // 상단바는 평소엔 배경 없이 캔버스 위에 '그냥 있는' 상태.
  // 스크롤이 시작되면 그때만 반투명 배경 + blur를 켜 글자가 겹쳐 읽히는 걸 막는다.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 브랜드 빛 번짐은 홈에서만. 다른 화면은 원래 평면 캔버스 그대로 둔다.
  const isHome = pathname === "/";

  // 폰 상태바(시간·배터리) 색을 화면 맨 윗줄 색과 맞춘다.
  //
  // theme-color는 단색 하나뿐이라 페이지마다 값이 달라야 이어져 보인다:
  //   홈      → 빛 번짐의 맨 윗줄 = 극단 색 10% + 캔버스
  //   그 외    → 평면 캔버스색 그대로
  // 색을 --accent에서 직접 계산하므로 극단 색을 바꾸면 상태바도 따라간다.
  // (CSS의 linear-gradient 첫 정거장과 같은 식이라 두 값이 정확히 일치한다)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const root = getComputedStyle(document.documentElement);
    const read = (name: string) => root.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
    const bg = read("--bg");
    if (bg.length < 3 || bg.some(Number.isNaN)) return;
    let color = `rgb(${bg[0]} ${bg[1]} ${bg[2]})`;
    if (isHome) {
      const ac = read("--accent");
      if (ac.length >= 3 && !ac.some(Number.isNaN)) {
        // CSS의 rgb(var(--accent) / 0.1)을 캔버스 위에 올린 것과 같은 계산
        const mix = (a: number, b: number) => Math.round(b * 0.9 + a * 0.1);
        color = `rgb(${mix(ac[0], bg[0])} ${mix(ac[1], bg[1])} ${mix(ac[2], bg[2])})`;
      }
    }
    meta.setAttribute("content", color);
    // 극단 색은 설정이 늦게 로드되며 바뀔 수 있어 의존성에 둔다
  }, [isHome, settings.accentColor]);

  // 현재 페이지 섹션은 '봤음'으로 기록 → NEW·빨간점 사라짐
  useEffect(() => {
    const sec = sectionOf(pathname);
    if (sec) markSeen(sec);
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const Wordmark = ({ className = "h-7" }: { className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/wordmark.png" alt="ALIVE" className={`${className} w-auto select-none`} draggable={false} />
  );

  return (
    <div className={`min-h-[100svh] ${isHome ? "app-canvas" : "bg-canvas"}`}>
      {/* 헤더 */}
      <header
        className={`sticky top-0 z-30 transition-[background-color,box-shadow] duration-200 ${
          scrolled || searchOpen
            ? "bg-canvas/85 shadow-[0_1px_0_rgba(16,24,40,0.06)] backdrop-blur-md"
            : "bg-transparent"
        }`}
      >
        <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:gap-4">
          {searchOpen ? (
            /* ===== 검색 모드: 로고 + 검색창 + 닫기 ===== */
            <>
              <Link href="/" className="hidden shrink-0 items-center sm:flex">
                <Wordmark />
              </Link>
              <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-4 py-2.5">
                <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" />
                <input
                  ref={searchRef}
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="ALIVE 전체 검색"
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => setTerm("")}
                    aria-label="검색어 지우기"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </form>
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setTerm("");
                }}
                aria-label="검색 닫기"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </>
          ) : (
            /* ===== 기본 모드 ===== */
            <>
              {/* 로고가 맨 왼쪽, 프로필은 오른쪽 끝.
                  예전엔 모바일에서 프로필이 로고 왼쪽에 붙어 있었는데,
                  '+' 등록을 걷어내 오른쪽에 자리가 생기면서 프로필을 그리로 옮겼다.
                  로고가 왼쪽 끝에 서니 아래 콘텐츠의 왼쪽 선과도 맞는다. */}
              <Link href="/" aria-label="홈" className="flex shrink-0 items-center">
                <Wordmark className="h-[22px] md:h-5" />
              </Link>

              {/* PC: 가로 메뉴 */}
              <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
                {links.map((n) => {
                  const active = pathname === n.href;
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`relative flex h-16 items-center px-3.5 text-sm font-medium transition ${
                        active ? "text-accent" : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {n.label}
                      {isNew(n.href) && <NewBadge />}
                      {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
                    </Link>
                  );
                })}
              </nav>

              {/* 오른쪽 아이콘들: 검색 · 알림 · 프로필 */}
              <div className="ml-auto flex items-center gap-0.5 md:gap-1">
                <button
                  onClick={() => setSearchOpen(true)}
                  aria-label="검색"
                  className="grid h-10 w-10 place-items-center rounded-full text-slate-700 transition hover:bg-slate-100"
                >
                  <SearchIcon className="h-[22px] w-[22px]" />
                </button>

                {/* 알림 (오른쪽 슬라이드 패널) */}
                <NotificationBell />

                {/* 프로필 — 예전 '+' 자리. 모바일·PC 모두 오른쪽 끝이다 */}
                <button
                  onClick={() => setMenuOpen(true)}
                  aria-label="내 메뉴"
                  aria-expanded={menuOpen}
                  className="ml-0.5 grid h-10 w-10 place-items-center"
                >
                  <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-8 w-8 text-sm" />
                </button>
              </div>

            </>
          )}
        </div>
      </header>

      {/* 프로필 메뉴 — 내 프로필 · 멤버 · 관리 · 로그아웃 */}
      <BottomSheet open={menuOpen} title="메뉴" onClose={() => setMenuOpen(false)}>
        <Link
          href="/profile"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3.5 rounded-xl px-1 py-3 transition hover:bg-slate-50"
        >
          <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-12 w-12 text-lg" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold text-slate-900">
              {profile?.name || profile?.displayName}
            </span>
            <span className="block text-sm text-slate-400">내 프로필 설정</span>
          </span>
        </Link>

        <div className="mt-1 border-t border-slate-100 pt-1">
          {menuLinks.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center gap-4 rounded-xl px-1 py-3.5 transition hover:bg-slate-50"
            >
              <m.icon className="h-[22px] w-[22px] shrink-0 text-[#1a2744]" />
              <span className="text-[15px] font-semibold text-slate-800">{m.label}</span>
              {isNew(m.href) && <NewBadge />}
            </Link>
          ))}

          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-4 rounded-xl px-1 py-3.5 transition hover:bg-slate-50"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400">
              <path
                d="M15 17l5-5-5-5M20 12H9M12 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[15px] font-semibold text-slate-500">로그아웃</span>
          </button>
        </div>
      </BottomSheet>

      <main className="mx-auto max-w-5xl px-4 py-8 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-8">
        {children}
      </main>

      {/* 첫 실행 시 푸시 알림 안내 모달 */}
      <PushOnboard />
    </div>
  );
}
