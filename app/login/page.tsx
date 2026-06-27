"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

export default function LoginPage() {
  const { user, role, loading, signIn } = useAuth();
  const { settings } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !user) return;
    if (role === "guest") router.replace("/pending");
    else if (role) router.replace("/");
  }, [loading, user, role, router]);

  async function handleSignIn() {
    setError("");
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 팝업을 닫은 경우는 조용히 무시
      if (!msg.includes("popup-closed") && !msg.includes("cancelled")) {
        setError("로그인에 실패했어요. 다시 시도해 주세요.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-white px-4">
      <div className="w-full max-w-sm text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/wordmark.png" alt="ALIVE" className="mx-auto mb-6 h-10 w-auto" />
        <h1 className="text-xl font-bold italic tracking-tight text-slate-900">Today here, Right now!</h1>
        <p className="mt-2 text-sm text-slate-500">
          구글 계정으로 로그인해 주세요.
        </p>

        <button
          onClick={handleSignIn}
          disabled={busy}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.2 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5z" />
          </svg>
          {busy ? "로그인 중…" : "구글로 로그인"}
        </button>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <p className="mt-8 text-xs text-slate-400">
          가입 후 관리자 승인이 완료되면 모든 기능을 이용할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
