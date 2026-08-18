"use client";

// 프로필 화면의 '푸시 알림' 켜기/끄기 스위치
//
// 브라우저 알림 권한은 한 번 '차단'하면 코드로 되돌릴 수 없다. 그래서
// 차단 상태일 땐 스위치 대신 "브라우저 설정에서 풀어주세요" 안내를 보여준다.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, pushEnabledHere, pushPermission, pushSupported, pushTest } from "@/lib/push";

type State = "loading" | "unsupported" | "blocked" | "off" | "on";

/** iOS인데 아직 홈 화면 앱으로 설치하지 않은 상태인가 (이 경우 푸시가 아예 불가) */
function iosNeedsInstall(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export default function PushToggle({
  /** 승인 대기 화면에서는 받을 알림이 '승인 완료' 하나뿐이라 문구가 다르다 */
  pending = false,
}: {
  pending?: boolean;
} = {}) {
  const { user } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      setNeedsInstall(iosNeedsInstall());
      if (!(await pushSupported())) {
        setState("unsupported");
        return;
      }
      const perm = pushPermission();
      if (perm === "denied") setState("blocked");
      else setState(pushEnabledHere() ? "on" : "off");
    })();
  }, []);

  async function toggle() {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (state === "on") {
        await disablePush();
        setState("off");
      } else {
        const ok = await enablePush(user.uid);
        if (ok) setState("on");
        else setState(pushPermission() === "denied" ? "blocked" : "off");
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  // iOS는 홈 화면에 설치해야만 푸시를 받을 수 있다 (애플 정책)
  if (state === "unsupported" && needsInstall) {
    return (
      <Row title="푸시 알림" desc="먼저 이 사이트를 홈 화면에 추가하면 알림을 받을 수 있어요.">
        <span className="shrink-0 text-xs font-semibold text-slate-400">설치 필요</span>
      </Row>
    );
  }

  if (state === "unsupported") {
    return (
      <Row title="푸시 알림" desc="이 브라우저에서는 알림을 지원하지 않아요.">
        <span className="shrink-0 text-xs font-semibold text-slate-400">사용 불가</span>
      </Row>
    );
  }

  if (state === "blocked") {
    return (
      <Row title="푸시 알림" desc="알림이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.">
        <span className="shrink-0 text-xs font-semibold text-red-400">차단됨</span>
      </Row>
    );
  }

  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      setTestMsg(await pushTest());
    } finally {
      setTesting(false);
    }
  }

  const on = state === "on";
  return (
    <div className="space-y-3">
    <Row
      title="푸시 알림"
      desc={
        pending
          ? on
            ? "승인되는 즉시 알려드릴게요."
            : "승인되면 바로 알 수 있게 알림을 켜둘까요?"
          : on
            ? "새 공지·일정·댓글이 있으면 알려드려요."
            : "공지·일정·댓글 알림을 이 기기에서 받아볼까요?"
      }
    >
      <button
        role="switch"
        aria-checked={on}
        aria-label="푸시 알림"
        onClick={toggle}
        disabled={busy}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          on ? "bg-accent" : "bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            on ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </Row>

      {/* 켜져 있을 때만 — 실제로 도착하는지 확인하는 용도 */}
      {on && (
        <div className="border-t border-slate-100 pt-3">
          <button
            onClick={runTest}
            disabled={testing}
            className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
          >
            {testing ? "보내는 중…" : "테스트 알림 보내기"}
          </button>
          {testMsg && (
            <p className={`mt-1.5 text-xs leading-relaxed ${testMsg.ok ? "text-slate-500" : "text-red-500"}`}>
              {testMsg.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
      </div>
      {children}
    </div>
  );
}
