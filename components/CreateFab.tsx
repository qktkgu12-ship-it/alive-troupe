"use client";

// 하단 내비게이션 바로 위에 떠 있는 등록 버튼.
//
//  · 페이지 맨 위에서는 '+ 글쓰기' 알약 모양
//  · 스크롤을 내리면 알약이 부드럽게 오므라들어 '+' 원형 버튼이 된다
//  · 누르면 버튼이 X로 돌아가고, 그 위로 등록 메뉴가 하나씩 떠오른다
//
// BottomNav와 마찬가지로 루트 레이아웃에 두어야 화면을 옮겨도
// 스크롤 상태·애니메이션이 끊기지 않는다.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useCreateSheet, type CreateKind } from "@/lib/create-sheet-context";
import { ArchiveIcon, BoardIcon, CalendarIcon, FolderIcon } from "@/components/Icons";

// 내비게이션 바(66px) 위로 12px 띄운다 — BottomNav의 바닥 여백과 같은 식을 쓴다
const BOTTOM = "calc(max(1.5rem, env(safe-area-inset-bottom) + 0.75rem) + 78px)";

const HIDDEN = ["/login", "/pending", "/board/write"];

type Item = {
  label: string;
  icon: React.FC<{ className?: string }>;
  tint: string; // 아이콘 원 배경색
  sheet: CreateKind | null; // null = href로 이동
  href?: string;
  admin: boolean;
};

const ITEMS: Item[] = [
  { label: "글쓰기", icon: BoardIcon, tint: "bg-sky-100 text-sky-600", sheet: null, href: "/board/write", admin: false },
  { label: "일정방 만들기", icon: CalendarIcon, tint: "bg-violet-100 text-violet-600", sheet: null, href: "/schedule?tab=coord&new=1", admin: false },
  { label: "확정 일정 등록", icon: CalendarIcon, tint: "bg-emerald-100 text-emerald-600", sheet: "event", admin: true },
  { label: "영상 등록", icon: ArchiveIcon, tint: "bg-rose-100 text-rose-600", sheet: "archive", admin: false },
  { label: "자료실 등록", icon: FolderIcon, tint: "bg-amber-100 text-amber-600", sheet: "audio", admin: false },
];

export default function CreateFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, role, loading } = useAuth();
  const { openCreate } = useCreateSheet();

  const [open, setOpen] = useState(false);
  // 맨 위(=글쓰기 알약)인지 / 스크롤 내려간 상태(=원형 +)인지
  const [atTop, setAtTop] = useState(true);

  // 스크롤 위치 감시 — 24px 안쪽이면 알약, 넘어가면 원
  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 화면을 옮기면 메뉴를 닫는다
  useEffect(() => setOpen(false), [pathname]);

  // 메뉴가 열려 있는 동안 뒤 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const pick = useCallback(
    (it: Item) => {
      setOpen(false);
      if (it.sheet) openCreate(it.sheet);
      else router.push(it.href!);
    },
    [openCreate, router]
  );

  if (loading || !user || role === "guest") return null;
  if (HIDDEN.some((h) => pathname === h || pathname.startsWith(h + "/"))) return null;

  const items = ITEMS.filter((i) => !i.admin || role === "admin");
  // 메뉴가 열려 있으면 알약은 무조건 원형(X)이 된다
  const pill = atTop && !open;

  return (
    <>
      {/* 뒷배경 — 메뉴가 열리면 화면을 어둡게 덮는다 */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div className="pointer-events-none fixed inset-x-0 z-50 px-7 " style={{ bottom: BOTTOM }}>
        <div className="mx-auto flex max-w-md flex-col items-end md:max-w-5xl gap-2.5">
          {/* 등록 메뉴 — 아래에서 위로 하나씩 떠오른다 */}
          <div className={`flex flex-col items-end gap-2 ${open ? "" : "pointer-events-none"}`}>
            {items.map((it, i) => {
              const Icon = it.icon;
              // 아래 항목부터 순서대로 나타나도록 역순으로 지연을 준다
              const delay = open ? (items.length - 1 - i) * 40 : i * 25;
              const inner = (
                <>
                  <span className="text-[15px] font-bold text-slate-800">{it.label}</span>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${it.tint}`}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                </>
              );
              const cls =
                "pointer-events-auto flex items-center gap-3 rounded-full bg-white/95 py-1.5 pl-5 pr-1.5 shadow-[0_6px_20px_-4px_rgba(16,24,40,0.28)] backdrop-blur transition active:scale-95";
              const style: React.CSSProperties = {
                opacity: open ? 1 : 0,
                transform: open ? "translateY(0) scale(1)" : "translateY(14px) scale(0.9)",
                transformOrigin: "bottom right",
                transition: `opacity 200ms ease ${delay}ms, transform 320ms cubic-bezier(0.34, 1.4, 0.4, 1) ${delay}ms`,
              };
              return it.sheet ? (
                <button key={it.label} onClick={() => pick(it)} className={cls} style={style}>
                  {inner}
                </button>
              ) : (
                <Link key={it.label} href={it.href!} onClick={() => setOpen(false)} className={cls} style={style}>
                  {inner}
                </Link>
              );
            })}
          </div>

          {/* 본체 버튼 — 알약 ↔ 원형이 폭 변화로 자연스럽게 이어진다 */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "등록 메뉴 닫기" : "등록"}
            aria-expanded={open}
            className="pointer-events-auto flex h-14 items-center justify-center overflow-hidden rounded-full bg-accent text-accent-fg shadow-[0_8px_24px_-4px_rgba(16,24,40,0.35)] active:scale-95"
            style={{
              width: pill ? 148 : 56,
              transition:
                "width 380ms cubic-bezier(0.32, 1.2, 0.4, 1), transform 150ms ease, background-color 200ms ease",
            }}
          >
            {/* + 가 45도 돌면 X가 된다 */}
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              aria-hidden="true"
              style={{
                transform: open ? "rotate(135deg)" : "rotate(0deg)",
                transition: "transform 380ms cubic-bezier(0.32, 1.2, 0.4, 1)",
              }}
            >
              <path d="M12 5v14M5 12h14" />
            </svg>

            {/* '글쓰기' 글자 — 폭과 함께 사라진다 */}
            <span
              className="whitespace-nowrap text-[17px] font-extrabold tracking-[-0.01em]"
              style={{
                maxWidth: pill ? 80 : 0,
                marginLeft: pill ? 6 : 0,
                marginRight: pill ? 8 : 0,
                opacity: pill ? 1 : 0,
                overflow: "hidden",
                transition:
                  "max-width 380ms cubic-bezier(0.32, 1.2, 0.4, 1), opacity 220ms ease, margin 380ms cubic-bezier(0.32, 1.2, 0.4, 1)",
              }}
            >
              글쓰기
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
