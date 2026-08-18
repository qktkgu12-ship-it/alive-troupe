"use client";

// 앱 첫 실행 시 푸시 알림 안내 — 전체 화면
// - 설치된 PWA에서 알림 권한이 아직 '미결정(default)'일 때 1회 표시
// - "알림 받기" → 시스템 권한 팝업 → enablePush
// - "나중에 받을게요." → 닫고 기록 (다시 안 뜸)

import { useEffect, useState } from "react";
import { enablePush, pushPermission, pushSupported } from "@/lib/push";
import { useAuth } from "@/lib/auth-context";

const ONBOARD_KEY = "alive-push-onboard";

export default function PushOnboard() {
  const { user, role } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 미리보기용 — 주소 뒤에 ?onboard=1 을 붙이면 조건 무시하고 무조건 표시
    try {
      if (new URLSearchParams(window.location.search).get("onboard") === "1") {
        setShow(true);
        return;
      }
    } catch {
      /* 무시 */
    }

    if (!user) return;
    if (role === "guest" || role === null) return;

    // 이미 허용했거나 차단했으면 안내할 필요가 없다
    const perm = pushPermission();
    if (perm === "granted" || perm === "denied") return;

    try {
      if (localStorage.getItem(ONBOARD_KEY)) return;
    } catch {
      /* 무시 */
    }

    pushSupported().then((ok) => {
      if (ok) setShow(true);
    });
  }, [user, role]);

  // 전체 화면인 동안 뒤쪽 스크롤 잠금
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [show]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(ONBOARD_KEY, "1");
    } catch {
      /* 무시 */
    }
  }

  async function allow() {
    if (busy) return;
    setBusy(true);
    try {
      if (user) await enablePush(user.uid);
    } catch {
      /* 무시 */
    } finally {
      setBusy(false);
      dismiss();
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-canvas px-7 pt-[env(safe-area-inset-top)] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {/* 가운데 — 아이콘 + 문구 */}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div
          className="grid h-[88px] w-[88px] place-items-center rounded-full bg-accent"
          style={{ boxShadow: "0 18px 40px -14px rgb(var(--accent) / 0.55)" }}
        >
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" className="text-accent-fg">
            <path
              d="M18 8A6 6 0 1 0 6 8c0 6-2.5 7-2.5 7h17S18 14 18 8Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M13.73 19a2 2 0 0 1-3.46 0"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="mt-7 text-[26px] font-extrabold tracking-tight text-slate-900">
          푸시 알림 받기
        </h1>
        <p className="mt-3 text-[15px] leading-[1.65] text-slate-500">
          푸시 알림을 허용하고
          <br />
          ALIVE의 소식들을 빠르게 받아보세요!
        </p>
      </div>

      {/* 아래 — 버튼 */}
      <div className="shrink-0">
        <button
          onClick={allow}
          disabled={busy}
          className="w-full rounded-full bg-accent py-[18px] text-[17px] font-bold text-accent-fg transition active:brightness-95 disabled:opacity-60"
        >
          {busy ? (
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent-fg/30 border-t-accent-fg align-middle" />
          ) : (
            "알림 받기"
          )}
        </button>

        <button
          onClick={dismiss}
          className="mx-auto mt-4 block py-1 text-[13px] text-slate-400 underline underline-offset-[3px] transition active:text-slate-500"
        >
          나중에 받을게요.
        </button>
      </div>
    </div>
  );
}
