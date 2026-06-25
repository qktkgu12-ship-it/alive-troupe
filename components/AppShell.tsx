"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

const NAV = [
  { href: "/", label: "홈", admin: false },
  { href: "/schedule", label: "일정", admin: false },
  { href: "/archive", label: "아카이빙", admin: false },
  { href: "/audio", label: "음원 자료실", admin: false },
  { href: "/members", label: "단원 명단", admin: true },
  { href: "/admin", label: "관리자", admin: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const { settings } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = NAV.filter((n) => !n.admin || role === "admin");

  // 페이지 이동 시 사이드바 닫기
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 사이드바 열릴 때 배경 스크롤 잠금
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

  return (
    <div className="min-h-screen">
      {/* 상단 메인컬러 박스 헤더 */}
      <header className="sticky top-0 z-30 bg-accent text-accent-fg shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center px-3 py-3">
          {/* 햄버거 (왼쪽) */}
          <button
            onClick={() => setOpen(true)}
            aria-label="메뉴 열기"
            className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-white/15"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>

          {/* 로고(가운데, 흰색) */}
          <div className="flex flex-1 flex-col items-center">
            <Link href="/" className="text-lg font-extrabold tracking-tight">
              {settings.troupeName}
            </Link>
            {settings.currentProduction && (
              <span className="text-[11px] font-medium opacity-80">{settings.currentProduction}</span>
            )}
          </div>

          {/* 오른쪽 균형용 빈 공간 */}
          <div className="h-10 w-10" />
        </div>
      </header>

      {/* 오버레이 */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* 슬라이드 사이드바 */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[78%] max-w-[300px] flex-col bg-accent text-accent-fg shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* 사이드바 상단 (브랜드) */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-base font-black">A</span>
            <div className="leading-tight">
              <p className="text-base font-extrabold">{settings.troupeName}</p>
              {settings.currentProduction && (
                <p className="text-[11px] opacity-80">{settings.currentProduction}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="메뉴 닫기"
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/15"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 메뉴 영역 — 헤더와 살짝 톤차이 (약간 어둡게) */}
        <nav className="flex-1 overflow-y-auto bg-black/10 py-2">
          {links.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 px-5 py-3.5 text-[15px] font-semibold transition ${
                  active ? "bg-white/20" : "hover:bg-white/10"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : "bg-white/40"}`} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* 하단 — 사용자 + 로그아웃 */}
        <div className="border-t border-white/15 bg-black/10 px-5 py-4">
          <p className="mb-2 truncate text-sm font-medium opacity-90">
            {profile?.name || profile?.displayName}
          </p>
          <button
            onClick={handleSignOut}
            className="w-full rounded-lg bg-white/15 py-2 text-sm font-semibold transition hover:bg-white/25"
          >
            로그아웃
          </button>
        </div>
      </aside>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
