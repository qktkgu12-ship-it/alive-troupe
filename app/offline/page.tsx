"use client";

// 네트워크가 끊겼을 때 서비스 워커가 대신 보여주는 화면.
// 이 경로는 서비스 워커 설치 시 미리 캐시되므로, 오프라인에서도 뜬다.

export default function OfflinePage() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="card w-full max-w-sm text-center !p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wordmark.png" alt="ALIVE" className="mx-auto mb-6 h-9 w-auto opacity-40" />
        <h1 className="text-lg font-bold text-slate-900">연결이 끊겼어요</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          인터넷에 연결한 뒤 다시 시도해 주세요.
          <br />
          이미 열어봤던 화면은 그대로 볼 수 있어요.
        </p>
        <button
          onClick={() => location.reload()}
          className="btn-accent mt-7 w-full"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
