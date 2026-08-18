"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { AdminIcon, ArchiveIcon, BoardIcon, CalendarIcon, FolderIcon, MembersIcon, PlusIcon, SearchIcon, XIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import NotificationBell from "@/components/NotificationBell";
import BottomSheet from "@/components/BottomSheet";
import { useCreateSheet, type CreateKind } from "@/lib/create-sheet-context";
import { usePostEditor } from "@/lib/post-editor-context";
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

const SECTIONS = ["/schedule", "/archive", "/audio", "/board", "/members", "/admin"];
// 경로/알림 href → 내비 섹션
function sectionOf(path: string): string | null {
  for (const base of SECTIONS) {
    if (path === base || path.startsWith(base + "/") || path.startsWith(base + "?")) return base;
  }
  return null;
}

// 헤더 '+' 등록 메뉴 — 게시판·일정방은 페이지로 이동, 나머지는 그 자리에서 시트로 열림
const CREATE_MENU: {
  sheet: CreateKind | "write" | null; // "write" = 글쓰기 시트, null = href로 이동
  href?: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  tint: string; // 아이콘 원 배경색
  admin: boolean;
}[] = [
  { sheet: "write", label: "글쓰기", icon: BoardIcon, tint: "bg-sky-100 text-sky-600", admin: false },
  { sheet: null, href: "/schedule?tab=coord&new=1", label: "일정방 만들기", icon: CalendarIcon, tint: "bg-violet-100 text-violet-600", admin: false },
  { sheet: "event", label: "확정 일정 등록", icon: CalendarIcon, tint: "bg-emerald-100 text-emerald-600", admin: true },
  { sheet: "archive", label: "영상 등록", icon: ArchiveIcon, tint: "bg-rose-100 text-rose-600", admin: false },
  { sheet: "audio", label: "자료실 등록", icon: FolderIcon, tint: "bg-amber-100 text-amber-600", admin: false },
];

const SEEN_KEY = "alive-nav-seen";

function NewBadge() {
  return (
    <span className="ml-1.5 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none tracking-wide text-accent-fg">
      NEW
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const { items } = useNotifications();
  const pathname = usePathname();
  const router = useRouter();
  // 헤더: 검색 모드 / '+' 등록 메뉴 / 프로필 메뉴
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [term, setTerm] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const links = NAV.filter((n) => !n.admin || role === "admin");
  // 하단 바에 자리가 없는 메뉴들 — 프로필 시트로 들어간다
  const menuLinks = [
    { href: "/members", label: "멤버", icon: MembersIcon, admin: false },
    { href: "/admin", label: "관리", icon: AdminIcon, admin: true },
  ].filter((m) => !m.admin || role === "admin");
  const createItems = CREATE_MENU.filter((c) => !c.admin || role === "admin");
  const { openCreate } = useCreateSheet();
  const { openWrite } = usePostEditor();

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

  // 섹션별 '가장 최근 새 항목' 시각 (알림 데이터 재사용)
  const latestBySection = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of items) {
      const sec = sectionOf(n.href);
      if (sec) m[sec] = Math.max(m[sec] ?? 0, n.time);
    }
    return m;
  }, [items]);

  // 섹션별 '마지막으로 본 시각' (방문하면 갱신, localStorage 저장)
  const [seen, setSeen] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"));
    } catch {
      /* 무시 */
    }
  }, []);

  // 현재 페이지 섹션은 '봤음'으로 기록 → NEW 사라짐
  useEffect(() => {
    const sec = sectionOf(pathname);
    if (!sec) return;
    setSeen((prev) => {
      const next = { ...prev, [sec]: Date.now() };
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
  }, [pathname]);

  const isNew = (href: string) => {
    const t = latestBySection[href];
    return !!t && t > (seen[href] ?? 0);
  };

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
    setCreateOpen(false);
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
    <div className="min-h-[100svh] bg-canvas">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
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
              {/* 모바일: 프로필이 맨 왼쪽 / PC: 로고가 맨 왼쪽
                  (등록은 오른쪽 알림 옆 + 버튼) */}
              <button
                onClick={() => setMenuOpen(true)}
                aria-label="내 메뉴"
                aria-expanded={menuOpen}
                className="-ml-0.5 grid h-10 w-10 shrink-0 place-items-center md:hidden"
              >
                <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-8 w-8 text-sm" />
              </button>

              <Link href="/" className="hidden shrink-0 items-center md:flex">
                <Wordmark className="h-5" />
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

              {/* 모바일: 로고를 화면 정중앙에 고정
                  (양옆 버튼 개수가 달라도 흔들리지 않도록 absolute로 못 박는다) */}
              <Link
                href="/"
                aria-label="홈"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:hidden"
              >
                <Wordmark className="h-[22px]" />
              </Link>

              {/* 오른쪽 아이콘들: 검색 · 알림 · (PC:프로필) */}
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

                {/* 등록(+) — 누르면 아래로 등록 메뉴 창이 열린다 */}
                <button
                  onClick={() => setCreateOpen((v) => !v)}
                  aria-label="등록"
                  aria-expanded={createOpen}
                  className="grid h-10 w-10 place-items-center rounded-full text-slate-700 transition hover:bg-slate-100"
                >
                  <PlusIcon
                    className={`h-[24px] w-[24px] transition-transform duration-300 ${
                      createOpen ? "rotate-[135deg]" : ""
                    }`}
                  />
                </button>

                {/* 프로필 — PC에서만 오른쪽에 남는다 (모바일은 왼쪽 상단) */}
                <button
                  onClick={() => setMenuOpen(true)}
                  aria-label="내 메뉴"
                  aria-expanded={menuOpen}
                  className="ml-0.5 hidden h-10 w-10 place-items-center md:grid"
                >
                  <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-8 w-8 text-sm" />
                </button>
              </div>

              {/* 등록 메뉴 — 헤더 오른쪽 아래로 펼쳐지는 창 하나 */}
              <div
                className={`absolute right-3 top-[calc(100%+6px)] w-60 origin-top-right transition-all duration-200 ${
                  createOpen
                    ? "pointer-events-auto scale-100 opacity-100"
                    : "pointer-events-none scale-95 opacity-0"
                }`}
              >
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(16,24,40,0.28)] backdrop-blur-xl">
                  {createItems.map((c) => {
                    const Icon = c.icon;
                    const inner = (
                      <>
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${c.tint}`}>
                          <Icon className="h-[17px] w-[17px]" />
                        </span>
                        <span className="text-[14.5px] font-semibold text-slate-800">{c.label}</span>
                      </>
                    );
                    const cls =
                      "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-slate-100 active:bg-slate-200";
                    return c.sheet ? (
                      <button
                        key={c.label}
                        onClick={() => {
                          setCreateOpen(false);
                          if (c.sheet === "write") openWrite();
                          else openCreate(c.sheet as CreateKind);
                        }}
                        className={cls}
                      >
                        {inner}
                      </button>
                    ) : (
                      <Link key={c.label} href={c.href!} onClick={() => setCreateOpen(false)} className={cls}>
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 등록 메뉴 바깥을 누르면 닫힌다 */}
      {createOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setCreateOpen(false)} aria-hidden />
      )}

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
