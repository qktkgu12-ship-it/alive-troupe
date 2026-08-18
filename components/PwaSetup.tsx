"use client";

// PWA 담당 컴포넌트 — 하는 일 세 가지
//  1) 서비스 워커 등록 (오프라인 캐싱 + 푸시 수신의 토대)
//  2) '앱으로 설치' 하단 배너 노출
//  3) 앱을 보고 있는 동안 도착한 푸시를 알림으로 띄우기
//
// 안드로이드/데스크톱 크롬은 beforeinstallprompt 이벤트로 설치창을 띄울 수 있지만,
// iOS 사파리는 그 이벤트가 없어서 '공유 → 홈 화면에 추가'를 직접 안내해야 한다.

import { useEffect, useState } from "react";
import { onForegroundPush, pushEnabledHere } from "@/lib/push";

const DISMISS_KEY = "alive-install-dismissed";
const DISMISS_DAYS = 30; // 배너를 닫으면 이 기간 동안 다시 띄우지 않는다

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** 이미 홈 화면 앱으로 실행 중인가 */
function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS 사파리 전용 플래그
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
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

export default function PwaSetup() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosGuide, setIosGuide] = useState(false);

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

  // ---- 앱을 보고 있는 동안 도착한 푸시 ----
  // 화면이 켜져 있으면 서비스 워커의 onBackgroundMessage가 호출되지 않고
  // 페이지로 바로 전달된다. 여기서 받아 직접 알림을 띄우지 않으면 그냥 사라진다.
  useEffect(() => {
    if (!pushEnabledHere()) return;
    let unsub: (() => void) | undefined;
    let dead = false;

    (async () => {
      const off = await onForegroundPush(async (n) => {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(n.title, {
            body: n.body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            data: { href: n.href },
          });
        } catch {
          /* 알림을 못 띄우는 환경이면 조용히 넘어간다 */
        }
      });
      if (dead) off();
      else unsub = off;
    })();

    return () => {
      dead = true;
      unsub?.();
    };
  }, []);

  // ---- 설치 배너 ----
  useEffect(() => {
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

    // iOS는 이벤트가 없으므로, 사파리라면 잠깐 뒤에 안내를 띄운다
    let t: number | undefined;
    if (isIos()) t = window.setTimeout(() => setShow(true), 2500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  function dismiss() {
    setShow(false);
    setIosGuide(false);
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
    // iOS — 직접 안내
    setIosGuide(true);
  }

  if (!show) return null;

  return (
    <>
      {/* 하단 배너 */}
      <div className="fixed inset-x-0 bottom-0 z-30 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_-12px_rgba(16,24,40,0.28)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">ALIVE를 앱으로</p>
            <p className="truncate text-xs text-slate-500">홈 화면에서 바로 열고, 알림도 받아요</p>
          </div>
          <button onClick={install} className="btn-accent shrink-0 !px-4 !py-2 text-sm">
            설치
          </button>
          <button
            onClick={dismiss}
            aria-label="닫기"
            className="shrink-0 rounded-lg px-1.5 py-1 text-lg leading-none text-slate-300 transition hover:text-slate-500"
          >
            ×
          </button>
        </div>
      </div>

      {/* iOS 설치 방법 안내 */}
      {iosGuide && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={dismiss}>
          <div className="card w-full max-w-sm !p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">홈 화면에 추가하기</h2>
            <ol className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="flex gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">1</span>
                <span>
                  아래쪽 <strong className="text-slate-900">공유 버튼</strong>
                  <span className="mx-1 inline-block align-text-bottom">
                    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" className="inline">
                      <path d="M7 1v11M7 1L3.5 4.5M7 1l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 8H1v9h12V8h-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  을 누르세요
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">2</span>
                <span>
                  목록을 내려 <strong className="text-slate-900">&apos;홈 화면에 추가&apos;</strong>를 누르세요
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">3</span>
                <span>
                  오른쪽 위 <strong className="text-slate-900">&apos;추가&apos;</strong>를 누르면 끝이에요
                </span>
              </li>
            </ol>
            <button onClick={dismiss} className="btn-ghost mt-6 w-full">
              알겠어요
            </button>
          </div>
        </div>
      )}
    </>
  );
}
