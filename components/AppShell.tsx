"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  const links = NAV.filter((n) => !n.admin || role === "admin");

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      {/* 상단 바 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-black text-accent-fg">
                A
              </span>
              <span className="text-base font-bold tracking-tight">
                {settings.troupeName}
              </span>
            </Link>
            {settings.currentProduction && (
              <span className="hidden rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent sm:inline">
                {settings.currentProduction}
              </span>
            )}
          </div>

          {/* 데스크탑 메뉴 */}
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  pathname === n.href
                    ? "bg-accent-soft text-accent"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {profile?.name || profile?.displayName}
            </span>
            <button onClick={handleSignOut} className="btn-ghost !px-3 !py-1.5">
              로그아웃
            </button>
            <button
              className="rounded-lg border border-slate-300 p-1.5 md:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="메뉴"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* 모바일 메뉴 */}
        {menuOpen && (
          <nav className="border-t border-slate-200 bg-white px-4 py-2 md:hidden">
            {links.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  pathname === n.href ? "bg-accent-soft text-accent" : "text-slate-700"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
