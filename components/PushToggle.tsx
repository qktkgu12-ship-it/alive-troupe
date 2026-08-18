"use client";

// '기기 알림' 켜기/끄기 스위치 (설정 화면 · 승인 대기 화면 공용)
//
// 브라우저 알림 권한은 한 번 '허용 안 함'을 누르면 코드로 되돌릴 수 없다.
// 그래서 차단된 상태에서 스위치를 누르면 기기 설정에서 푸는 방법을 안내한다.
//
// ⚠️ 웹앱은 기기의 설정 앱을 직접 열 수 없다 (네이티브 앱만 가능한 기능).
//    그래서 '알림 설정하러 가기'는 기기별 경로를 단계로 보여주는 것까지만 한다.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, pushEnabledHere, pushPermission, pushSupported } from "@/lib/push";

type State = "loading" | "unsupported" | "blocked" | "off" | "on";
type Platform = "ios" | "android" | "desktop";

function platformOf(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** 기기별 '알림 켜는 곳' 경로 안내 */
const HOW_TO: Record<Platform, string[]> = {
  ios: [
    "기기의 '설정' 앱을 여세요",
    "'알림'을 누르세요",
    "목록에서 'ALIVE'를 찾아 누르세요",
    "'알림 허용'을 켜주세요",
  ],
  android: [
    "기기의 '설정' 앱을 여세요",
    "'앱' → 'ALIVE'를 누르세요",
    "'알림'을 누르세요",
    "알림을 켜주세요",
  ],
  desktop: [
    "주소창 왼쪽의 자물쇠 아이콘을 누르세요",
    "'알림' 항목을 찾으세요",
    "'허용'으로 바꿔주세요",
    "페이지를 새로고침하세요",
  ],
};

export default function PushToggle({
  /** 승인 대기 화면에서는 받을 알림이 '승인 완료' 하나뿐이라 문구가 다르다 */
  pending = false,
}: {
  pending?: boolean;
} = {}) {
  const { user } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  // null=닫힘, "ask"=설정으로 가라는 안내, "how"=기기별 경로, "install"=홈 화면 추가 안내
  const [modal, setModal] = useState<null | "ask" | "how" | "install">(null);

  useEffect(() => {
    (async () => {
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

    // 차단된 상태 → 코드로 못 푼다. 기기 설정에서 푸는 법을 안내
    if (state === "blocked") {
      setModal("ask");
      return;
    }
    // iOS는 홈 화면에 추가해야만 알림을 받을 수 있다 (애플 정책)
    if (state === "unsupported") {
      setModal(platformOf() === "ios" && !isStandalone() ? "install" : "ask");
      return;
    }

    setBusy(true);
    try {
      if (state === "on") {
        await disablePush();
        setState("off");
      } else {
        const ok = await enablePush(user.uid);
        if (ok) {
          setState("on");
        } else if (pushPermission() === "denied") {
          setState("blocked");
          setModal("ask"); // 방금 '허용 안 함'을 눌렀다면 바로 안내
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  const on = state === "on";
  const desc = pending
    ? "승인되면 바로 알 수 있게 알려 드려요."
    : "새 공지, 일정, 댓글 등을 알려 드려요.";

  return (
    <>
      <button
        onClick={toggle}
        disabled={busy}
        className="flex w-full items-center gap-4 text-left disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-slate-900">기기 알림</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{desc}</span>
        </span>
        <span
          role="switch"
          aria-checked={on}
          className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-slate-200"}`}
        >
          <span
            className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${
              on ? "left-[25px]" : "left-[3px]"
            }`}
          />
        </span>
      </button>

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {modal === "ask" && (
            <>
              <h2 className="text-center text-[17px] font-bold text-slate-900">기기 알림 설정을 켜주세요.</h2>
              <p className="mt-3 text-center text-sm leading-relaxed text-slate-500">
                ALIVE에서 알림을 받으려면
                <br />
                기기 설정에서 알림을 켜주세요.
              </p>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setModal(null)} className="btn-ghost flex-1">
                  취소
                </button>
                <button onClick={() => setModal("how")} className="btn-accent flex-1">
                  알림 설정하러 가기
                </button>
              </div>
            </>
          )}

          {modal === "how" && (
            <>
              <h2 className="text-[17px] font-bold text-slate-900">알림 켜는 방법</h2>
              <ol className="mt-4 space-y-3">
                {HOW_TO[platformOf()].map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-400">
                웹앱은 기기의 설정 화면을 직접 열 수 없어서, 직접 이동해 주셔야 해요.
              </p>
              <button onClick={() => setModal(null)} className="btn-accent mt-5 w-full">
                확인
              </button>
            </>
          )}

          {modal === "install" && (
            <>
              <h2 className="text-[17px] font-bold text-slate-900">먼저 홈 화면에 추가해 주세요</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. (애플 정책)
              </p>
              <ol className="mt-4 space-y-3">
                {["사파리 아래쪽 공유 버튼을 누르세요", "'홈 화면에 추가'를 누르세요", "홈 화면의 ALIVE 앱으로 여세요"].map(
                  (step, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  )
                )}
              </ol>
              <button onClick={() => setModal(null)} className="btn-accent mt-5 w-full">
                알겠어요
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-[320px] !p-6" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
