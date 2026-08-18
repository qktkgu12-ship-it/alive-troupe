"use client";

// PWA 담당 컴포넌트 — 하는 일 두 가지
//  1) 서비스 워커 등록 (오프라인 캐싱 + 푸시 수신의 토대)
//  2) '앱으로 설치' 하단 배너 + 브라우저별 설치 가이드(전체 화면)
//
// 안드로이드 크롬은 beforeinstallprompt 이벤트로 설치창을 바로 띄울 수 있지만,
// iOS 사파리와 삼성 인터넷은 그 이벤트가 없어서 메뉴 위치를 직접 안내해야 한다.

import { useEffect, useState } from "react";
import { isMobileDevice } from "@/lib/utils";

const DISMISS_KEY = "alive-install-dismissed";
const DISMISS_DAYS = 30; // 배너를 닫으면 이 기간 동안 다시 띄우지 않는다

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** 설치 안내가 필요한 브라우저 종류 */
type Guide = "ios" | "samsung" | "android";

/** 이미 홈 화면 앱으로 실행 중인가 */
function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS 사파리 전용 플래그
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function detectGuide(): Guide {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  return "android";
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** 최근에 배너를 닫았는가 */
function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/* ─────────────────────────  단계별 그림  ───────────────────────── */

/** 그림을 감싸는 회색 판 — 실제 브라우저 UI를 흉내 낸다 */
function Plate({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mt-3 overflow-hidden rounded-xl bg-surface ${className}`}>{children}</div>
  );
}

/** iOS 사파리 하단 툴바 (최신 UI) — 뒤로 · 주소 알약 · ⋯ 버튼 강조 */
function IosToolbar() {
  return (
    <Plate>
      <div className="flex items-center gap-2 px-3 py-3">
        {/* 뒤로 */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-slate-800">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        {/* 주소 알약 */}
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-800">
            <rect x="4" y="4" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M4 17h16M4 20.5h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-800">alive-troupe.vercel.app</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-800">
            <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        {/* ⋯ 메뉴 — 강조 */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-accent shadow-[0_2px_8px_rgba(16,24,40,0.14)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="19" cy="12" r="1.9" />
          </svg>
        </span>
      </div>
    </Plate>
  );
}

/** ⋯ 메뉴가 열린 모습 — 맨 위 '공유' 강조 */
function IosShareMenu() {
  const rows: [string, React.ReactNode][] = [
    [
      "북마크에 추가",
      <svg key="b" width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M6 3.5h12v17l-6-4.5-6 4.5v-17Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>,
    ],
    [
      "새로운 탭",
      <svg key="t" width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>,
    ],
  ];
  return (
    <Plate>
      <div className="divide-y divide-slate-200/70 bg-white/70">
        {/* 공유 — 맨 위, 강조 */}
        <div className="flex items-center gap-3 bg-accent-soft px-4 py-3">
          <span className="text-accent">
            <svg width="17" height="19" viewBox="0 0 14 18" fill="none">
              <path d="M7 1.5v10M7 1.5L4 4.5M7 1.5l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.5 8H1.5v8.5h11V8h-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[14px] font-bold text-accent">공유</span>
        </div>
        {rows.map(([label, icon]) => (
          <div key={label} className="flex items-center gap-3 px-4 py-3 opacity-45">
            <span className="text-slate-500">{icon}</span>
            <span className="text-[14px] text-slate-600">{label}</span>
          </div>
        ))}
      </div>
    </Plate>
  );
}

/** 안드로이드 크롬 상단 바 — ⋮ 강조 */
function ChromeTopbar() {
  return (
    <Plate>
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-slate-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate rounded-full bg-white px-3 py-1.5 text-xs text-slate-400">
          alive.app
        </span>
        {/* ⋮ 메뉴 — 강조 */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-accent shadow-[0_2px_8px_rgba(16,24,40,0.12)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="12" cy="19" r="1.9" />
          </svg>
        </span>
      </div>
    </Plate>
  );
}

/** 삼성 인터넷 하단 바 — ☰ 강조 */
function SamsungToolbar() {
  return (
    <Plate>
      <div className="flex items-center justify-around px-3 py-3 text-slate-400">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="opacity-40">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 5h16M4 12h16M4 19h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="opacity-40" />
        </svg>
        {/* ☰ 메뉴 — 강조 */}
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-accent shadow-[0_2px_8px_rgba(16,24,40,0.12)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </div>
    </Plate>
  );
}

/** 메뉴 안의 한 줄 — '홈 화면에 추가' 같은 항목 */
function MenuRow({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <Plate>
      <div className="flex items-center justify-between bg-white/70 px-4 py-3.5">
        <span className="text-[14px] font-medium text-slate-800">{label}</span>
        <span className="text-accent">{icon}</span>
      </div>
    </Plate>
  );
}

const PlusBox = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const PhoneDown = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <rect x="6" y="2.5" width="12" height="19" rx="3" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 8v6m0 0l-2.2-2.2M12 14l2.2-2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 홈 화면에 놓인 앱 아이콘 */
function HomeIcon() {
  return (
    <Plate>
      <div className="flex flex-col items-center gap-2 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-14 w-14 rounded-[14px] shadow-[0_6px_16px_-4px_rgba(16,24,40,0.3)]" />
        <span className="text-[11px] font-medium text-slate-500">ALIVE</span>
      </div>
    </Plate>
  );
}

/** 브라우저별 설치 단계 */
function steps(guide: Guide) {
  if (guide === "ios") {
    return [
      { title: "브라우저 하단 ⋯ 버튼 탭", art: <IosToolbar /> },
      { title: "맨 위 '공유' 선택", art: <IosShareMenu /> },
      { title: "'홈 화면에 추가' 선택", art: <MenuRow label="홈 화면에 추가" icon={PlusBox} /> },
      { title: "추가된 앱 실행", art: <HomeIcon /> },
    ];
  }
  if (guide === "samsung") {
    return [
      { title: "브라우저 하단 메뉴 탭", art: <SamsungToolbar /> },
      { title: "'현재 페이지 추가' 선택", art: <MenuRow label="현재 페이지 추가" icon={PlusBox} /> },
      { title: "'홈 화면' 선택 후 앱 실행", art: <HomeIcon /> },
    ];
  }
  return [
    { title: "브라우저 우측 상단 메뉴 탭", art: <ChromeTopbar /> },
    { title: "'앱 설치' 선택", art: <MenuRow label="앱 설치" icon={PhoneDown} /> },
    { title: "추가된 앱 실행", art: <HomeIcon /> },
  ];
}

/* ─────────────────────────  본체  ───────────────────────── */

export default function PwaSetup() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guide, setGuide] = useState<Guide>("android");

  // ---- 서비스 워커 등록 ----
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // 첫 화면 렌더를 방해하지 않도록 로드가 끝난 뒤에 등록
    // register만으로는 브라우저가 옛 워커를 계속 쓸 수 있어, 매번 갱신을 확인시킨다
    const go = () =>
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => reg.update().catch(() => {}))
        .catch(() => {});
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, []);

  // 앱을 보고 있을 때 도착한 알림은 따로 처리하지 않는다.
  // 서비스 워커가 push 이벤트를 직접 받아 어느 상황에서든 알림을 띄우므로,
  // 여기서 또 띄우면 같은 알림이 두 번 뜬다.

  // ---- 설치 배너 ----
  useEffect(() => {
    setGuide(detectGuide());

    // PC에서는 설치 배너를 띄우지 않는다
    if (!isMobileDevice()) return;
    if (isInstalled() || recentlyDismissed()) return;

    // 안드로이드·데스크톱 크롬
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 브라우저 기본 설치 배너를 막고 우리가 원하는 시점에 띄운다
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // 설치가 끝나면 배너를 거둔다
    const onInstalled = () => setShow(false);
    window.addEventListener("appinstalled", onInstalled);

    // iOS·삼성 인터넷은 이벤트가 없으므로 잠깐 뒤에 직접 띄운다
    let t: number | undefined;
    if (isIos() || /samsungbrowser/i.test(navigator.userAgent)) {
      t = window.setTimeout(() => setShow(true), 2500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  // 배너·가이드가 떠 있는 동안 뒤쪽 스크롤 잠금
  useEffect(() => {
    if (!show && !guideOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show, guideOpen]);

  function dismiss() {
    setShow(false);
    setGuideOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* 무시 */
    }
  }

  async function install() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setShow(false);
      return;
    }
    // 설치 이벤트가 없는 브라우저 — 직접 안내
    setGuideOpen(true);
  }

  if (!show) return null;

  return (
    <>
      {/* ── 하단 배너 ── */}
      {/* 뒤쪽을 어둡게 깔아 바텀시트와 같은 느낌을 준다 */}
      <div
        onClick={dismiss}
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 z-40 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="relative mx-auto max-w-sm rounded-3xl bg-white px-6 pb-6 pt-7 shadow-[0_20px_60px_-16px_rgba(16,24,40,0.35)]">
          {/* 닫기 */}
          <button
            onClick={dismiss}
            aria-label="닫기"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-slate-300 transition active:text-slate-500"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" className="h-14 w-14 rounded-2xl shadow-[0_6px_18px_-6px_rgba(16,24,40,0.35)]" />
          </div>

          <p className="mt-5 text-center text-[18px] font-medium leading-[1.5] tracking-[-0.035em] text-slate-700">
            홈 화면에 <strong className="font-extrabold text-slate-900">ALIVE 앱</strong> 추가하고
            <br />
            소식을 더 빠르게 받아보세요.
          </p>

          <button
            onClick={install}
            className="mt-6 w-full rounded-full bg-accent py-[17px] text-[16px] font-bold text-accent-fg transition active:brightness-95"
          >
            {deferred ? "앱으로 설치하기" : "홈 화면에 추가하기"}
          </button>

          <button
            onClick={dismiss}
            className="mx-auto mt-3.5 block py-1 text-[13px] text-slate-400 underline underline-offset-[3px] transition active:text-slate-500"
          >
            오늘은 그냥 볼게요.
          </button>
        </div>
      </div>

      {/* ── 설치 가이드 (전체 화면) ── */}
      {guideOpen && (
        <div className="fixed inset-x-0 top-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas pt-[env(safe-area-inset-top)]">
          {/* 상단 뒤로가기 */}
          <div className="sticky top-0 z-10 bg-canvas/90 px-3 py-3 backdrop-blur">
            <button
              onClick={() => setGuideOpen(false)}
              aria-label="뒤로"
              className="grid h-10 w-10 place-items-center rounded-full text-slate-700 transition active:bg-slate-200/60"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* 툴바가 겹쳐도 마지막 카드가 보이도록 넉넉히 띄운다 */}
          <div className="mx-auto max-w-md px-6 pb-[calc(7rem+env(safe-area-inset-bottom))]">
            <span className="inline-block rounded-full bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white">
              {guide === "ios" ? "앱스토어 다운로드 없이" : "구글플레이 다운로드 없이"}
            </span>
            <h1 className="mt-3 text-[24px] font-extrabold tracking-tight text-slate-900">
              홈화면에 앱을 추가하세요!
            </h1>

            <div className="mt-6 space-y-3">
              {steps(guide).map((s, i) => (
                <div key={s.title} className="card !p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-accent text-[12px] font-bold text-accent-fg">
                      {i + 1}
                    </span>
                    <span className="text-[14px] font-semibold text-slate-800">{s.title}</span>
                  </div>
                  {s.art}
                </div>
              ))}
            </div>

            <button onClick={dismiss} className="btn-ghost mt-7 w-full !rounded-full !py-3.5">
              알겠어요
            </button>
          </div>
        </div>
      )}
    </>
  );
}
