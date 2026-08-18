"use client";

// 앱을 처음 열었을 때 알림을 켜도록 권하는 안내.
//
// 왜 시스템 창을 곧바로 띄우지 않는가:
//   iOS(사파리)는 Notification.requestPermission()을 '사용자가 뭔가를 누른 직후'에만
//   허용한다. 앱을 열자마자 호출하면 창이 뜨지 않고 그대로 무시된다.
//   그래서 우리 안내를 먼저 띄우고, '허용'을 누른 그 순간에 시스템 창을 연다.
//
// 한 번 닫으면 다시 띄우지 않는다. 나중에 켜고 싶으면 설정 화면에서 하면 된다.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { enablePush, pushEnabledHere, pushPermission, pushSupported } from "@/lib/push";

const SEEN_KEY = "alive-push-onboard-seen";

export default function PushOnboard() {
  const { user, role } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 승인 대기(guest)는 자기 화면에 이미 알림 스위치가 있으므로 건너뛴다
    if (!user || role === "guest" || role === null) return;

    (async () => {
      try {
        if (localStorage.getItem(SEEN_KEY)) return;
      } catch {
        return;
      }
      if (!(await pushSupported())) return;
      // 이미 허용했거나 이미 거절한 사람에게는 묻지 않는다
      if (pushPermission() !== "default") return;
      if (pushEnabledHere()) return;

      // 첫 화면이 뜨자마자 가리지 않도록 잠깐 뒤에
      setTimeout(() => setShow(true), 1200);
    })();
  }, [user, role]);

  function close() {
    setShow(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* 무시 */
    }
  }

  async function allow() {
    if (!user || busy) return;
    setBusy(true);
    try {
      // 이 호출이 '버튼을 누른 흐름' 안에 있어야 iOS에서 시스템 창이 뜬다
      await enablePush(user.uid);
    } finally {
      setBusy(false);
      close();
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-5 backdrop-blur-sm">
      <div className="card w-full max-w-[320px] !p-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-2xl">🔔</span>
        <h2 className="mt-4 text-[17px] font-bold text-slate-900">알림을 받아보시겠어요?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          새 공지와 일정, 내 글의 댓글을
          <br />
          바로 알려 드릴게요.
        </p>
        <div className="mt-6 flex gap-2">
          <button onClick={close} disabled={busy} className="btn-ghost flex-1">
            나중에
          </button>
          <button onClick={allow} disabled={busy} className="btn-accent flex-1">
            {busy ? "…" : "받을게요"}
          </button>
        </div>
      </div>
    </div>
  );
}
