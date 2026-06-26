"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { NAV_ICON } from "@/components/Icons";
import Avatar from "@/components/Avatar";

const NAV = [
  { href: "/", label: "홈", admin: false },
  { href: "/schedule", label: "일정", admin: false },
  { href: "/archive", label: "아카이브", admin: false },
  { href: "/audio", label: "음원 자료실", admin: false },
  { href: "/board", label: "게시판", admin: false },
  { href: "/members", label: "단원 명단", admin: true },
  { href: "/admin", label: "관리자", admin: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = NAV.filter((n) => !n.admin || role === "admin");

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const Wordmark = () => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/wordmark.png" alt="ALIVE" className="h-7 w-auto select-none" draggable={false} />
  );

  return (
    <div className="min-h-screen bg-slate-50/40">
      {/* 뉴트럴 헤더 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          {/* 모바일: 햄버거 */}
          <button
            onClick={() => setOpen(true)}
            aria-label="메뉴 열기"
            className="-ml-1 grid h-10 w-10 place-items-center rounded-lg text-slate-700 transition hover:bg-slate-100 md:hidden"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* 로고 (모바일 가운데 / PC 왼쪽) */}
          <Link
            href="/"
            className="flex flex-1 items-center justify-center md:flex-none md:justify-start"
          >
            <Wordmark />
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
                  {active && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* PC: 사용자 */}
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/profile" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-100">
              <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-8 w-8 text-sm" />
              <span className="text-sm font-medium text-slate-600">
                {profile?.name || profile?.displayName}
              </span>
            </Link>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              로그아웃
            </button>
          </div>

          {/* 모바일: 프로필 사진 (오른쪽 상단) */}
          <Link href="/profile" className="grid h-10 w-10 place-items-center md:hidden">
            <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-8 w-8 text-sm" />
          </Link>
        </div>
      </header>

      {/* 모바일 사이드바 오버레이 */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* 모바일 슬라이드 사이드바 */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[80%] max-w-[320px] flex-col bg-white shadow-2xl transition-transform duration-300 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <Wordmark />
          <button
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          {links.map((n) => {
            const active = pathname === n.href;
            const Icon = NAV_ICON[n.href];
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`mb-0.5 flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium transition ${
                  active ? "bg-accent-soft text-accent" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {Icon && <Icon className={`h-5 w-5 ${active ? "text-accent" : "text-slate-400"}`} />}
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <Link href="/profile" className="mb-3 flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50">
            <Avatar src={profile?.avatar} name={profile?.name || profile?.displayName} className="h-10 w-10 text-base" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {profile?.name || profile?.displayName}
              </p>
              <p className="text-xs text-slate-400">내 프로필 설정</p>
            </div>
          </Link>
          <button onClick={handleSignOut} className="btn-ghost w-full">
            로그아웃
          </button>
        </div>
      </aside>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
