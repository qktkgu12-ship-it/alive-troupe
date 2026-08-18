"use client";

// 설정 — 기기 알림처럼 '계정'이 아니라 '이 기기'에 대한 항목을 모아 둔다.
// 프로필(이름·사진·소개)은 /profile 로 분리.

import { useRouter } from "next/navigation";
import Link from "next/link";
import Guard from "@/components/Guard";
import PushToggle from "@/components/PushToggle";
import { useAuth } from "@/lib/auth-context";

function SettingsInner() {
  const { profile, signOut } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">설정</h1>

      {/* 알림 — 기기마다 따로 켜야 해서 계정 설정과 분리 */}
      <div className="card">
        <PushToggle />
      </div>

      <div className="card divide-y divide-slate-100 !p-0">
        <Link href="/profile" className="flex items-center justify-between px-5 py-4 transition hover:bg-slate-50">
          <span className="text-[15px] text-slate-800">내 프로필</span>
          <span className="text-slate-300">›</span>
        </Link>
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[15px] text-slate-800">계정</span>
          <span className="truncate pl-4 text-sm text-slate-400">{profile?.email}</span>
        </div>
      </div>

      <button onClick={handleSignOut} className="btn-ghost w-full">
        로그아웃
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Guard>
      <SettingsInner />
    </Guard>
  );
}
