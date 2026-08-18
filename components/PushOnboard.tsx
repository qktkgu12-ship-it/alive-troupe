"use client";

// 앱 첫 실행 시 푸시 알림 안내 모달
// - 설치된 PWA에서 첫 실행 때만 1회 표시
// - "알림 받기" → 시스템 권한 팝업 → enablePush
// - "나중에 받을게요" → 닫고 localStorage 기록 (30일 후 다시 표시 안 함)

import { useEffect, useState } from "react";
import { enablePush, pushPermission, pushSupported } from "@/lib/push";
import { useAuth } from "@/lib/auth-context";

const ONBOARD_KEY = "alive-push-onboard";

export default function PushOnboard() {
  const { user, role } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    // 게스트는 표시 안 함
    if (role === "guest" || role === null) return;

    // 이미 권한이 결정된 경우(granted / denied)는 안내 불필요
    const perm = pushPermission();
    if (perm === "granted" || perm === "denied") return;

    // 이미 봤으면 다시 안 뜸
    try {
      if (localStorage.getItem(ONBOARD_KEY)) return;
    } catch {
      /* 무시 */
    }

    // 푸시 지원 여부 확인 후 표시 (비동기)
    pushSupported().then((ok) => {
      if (ok) setShow(true);
    });
  }, [user, role]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(ONBOARD_KEY, "1");
    } catch {
      /* 무시 */
    }
  }

  async function allow() {
    if (!user || busy) return;
    setBusy(true);
    try {
      await enablePush(user.uid);
    } catch {
      /* 무시 */
    } finally {
      setBusy(false);
      dismiss();
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end justify-center bg-slate-900/40 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
      {/* 하단 카드 */}
      <div
        className="w-full max-w-md rounded-t-3xl bg-white px-6 pt-8 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_-8px_rgba(16,24,40,0.22)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 아이콘 */}
        <div className="mb-5 flex justify-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-accent">
              <path
                d="M15 17H20L18.595 15.595C18.21 15.21 18 14.679 18 14.127V11C18 8.388 16.279 6.173 13.996 5.348C13.998 5.233 14 5.117 14 5C14 3.895 13.105 3 12 3C10.895 3 10 3.895 10 5C10 5.117 10.002 5.233 10.004 5.348C7.72 6.173 6 8.388 6 11V14.127C6 14.679 5.79 15.21 5.405 15.595L4 17H9M15 17H9M15 17V18C15 19.657 13.657 21 12 21C10.343 21 9 19.657 9 18V17"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-center text-[19px] font-extrabold tracking-tight text-slate-900">
          푸시 알림 받기
        </h2>
        <p className="mt-2 text-center text-[14px] leading-relaxed text-slate-500">
          푸시 알림을 허용하고 ALIVE의 소식들을<br />빠르게 받아보세요!
        </p>

        <button
          onClick={allow}
          disabled={busy}
          className="btn-accent mt-6 w-full !py-3.5 text-[15px]"
        >
          {busy ? "처리 중…" : "알림 받기"}
        </button>

        <button
          onClick={dismiss}
          className="mt-3 w-full py-2.5 text-sm text-slate-400 underline underline-offset-2 transition hover:text-slate-500"
        >
          나중에 받을게요.
        </button>
      </div>
    </div>
  );
}
