"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { pushSignupRequest } from "@/lib/push";
import PushToggle from "@/components/PushToggle";
import Spinner from "@/components/Spinner";

export default function PendingPage() {
  const { user, profile, role, loading, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (role && role !== "guest") router.replace("/"); // 승인됨
  }, [loading, user, role, router]);

  useEffect(() => {
    if (profile) {
      setName(profile.name || profile.displayName || "");
      setContact(profile.contact || "");
      setBio(profile.bio || "");
    }
  }, [profile]);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { name, contact, bio },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await refreshProfile();
      // 정보를 채워 넣은 시점 = 검토해 달라는 신호. 관리자에게 한 번만 알린다.
      // (저장 버튼을 여러 번 눌러도 반복해서 울리지 않도록 표시를 남긴다)
      const flag = `alive-signup-notified-${user.uid}`;
      try {
        if (!localStorage.getItem(flag)) {
          localStorage.setItem(flag, "1");
          void pushSignupRequest();
        }
      } catch {
        /* 저장소를 못 써도 가입 자체는 진행 */
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="card">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-xl">
            ⏳
          </span>
          <div>
            <h1 className="text-lg font-bold">승인 대기 중이에요</h1>
            <p className="text-sm text-slate-500">
              관리자가 승인하면 모든 기능을 이용할 수 있습니다.
            </p>
          </div>
        </div>

        <p className="mb-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          아래 정보를 입력해 두시면 관리자가 더 빠르게 확인하고 승인할 수 있어요.
          (승인 후에도 관리자 페이지에서 수정 가능합니다)
        </p>

        <div className="space-y-3">
          <div>
            <label className="label">이름</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="실명" />
          </div>
          <div>
            <label className="label">연락처</label>
            <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="label">소개글</label>
            <textarea className="input min-h-[80px]" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="간단한 자기소개를 적어주세요" />
          </div>
        </div>

        <button onClick={save} disabled={busy} className="btn-accent mt-5 w-full">
          {busy ? "저장 중…" : saved ? "저장됐어요 ✓" : "정보 저장하기"}
        </button>

        {/* 승인되는 순간 바로 알 수 있도록, 대기 중에도 알림을 켤 수 있게 한다 */}
        <div className="mt-5 border-t border-slate-100 pt-5">
          <PushToggle pending />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>{profile?.email}</span>
          <button onClick={() => signOut().then(() => router.replace("/login"))} className="underline">
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
