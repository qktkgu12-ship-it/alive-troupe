"use client";

import { useEffect, useRef, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import Avatar from "@/components/Avatar";
import PushToggle from "@/components/PushToggle";
import { compressImage } from "@/components/ImagePicker";

function ProfileInner() {
  const { user, profile, role, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string>("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setAvatar(profile.avatar || "");
      setName(profile.name || profile.displayName || "");
      setContact(profile.contact || "");
      setBio(profile.bio || "");
    }
  }, [profile]);

  async function onPick(file: File | null) {
    if (!file) return;
    setImgBusy(true);
    try {
      // 프로필 사진은 글마다 붙어다니므로 더 작게 압축 (128px)
      const data = await compressImage(file, 128, 0.7);
      setAvatar(data);
    } catch {
      alert("이미지를 불러오지 못했어요.");
    } finally {
      setImgBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { avatar, name, contact, bio },
        { merge: true }
      );
      // 단원끼리 보이는 공개 프로필도 함께 갱신 (연락처는 제외)
      await setDoc(
        doc(db, "publicProfiles", user.uid),
        { name, bio, avatar, role: profile?.role },
        { merge: true }
      );
      await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">내 프로필</h1>

      <div className="card space-y-5">
        {/* 프로필 사진 */}
        <div className="flex items-center gap-4">
          <Avatar src={avatar} name={name} className="h-20 w-20 text-2xl" />
          <div className="space-y-2">
            <button onClick={() => fileRef.current?.click()} disabled={imgBusy} className="btn-ghost !py-1.5">
              {imgBusy ? "처리 중…" : "사진 변경"}
            </button>
            {avatar && (
              <button onClick={() => setAvatar("")} className="block text-xs text-red-500 hover:underline">
                기본 이미지로
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        </div>

        <div>
          <label className="label">이름</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="실명" />
        </div>
        <div>
          <label className="label">연락처 (관리자만 열람)</label>
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="010-0000-0000" />
        </div>
        <div>
          <label className="label">소개글</label>
          <textarea
            className="input min-h-[96px]"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="간단한 자기소개를 적어주세요"
          />
        </div>

        <button onClick={save} disabled={busy} className="btn-accent w-full">
          {busy ? "저장 중…" : saved ? "저장됐어요 ✓" : "저장"}
        </button>
      </div>

      {/* 알림 설정 — 기기마다 따로 켜야 하므로 프로필 저장과 분리 */}
      <div className="card">
        <PushToggle />
      </div>

      {/* 임시 테스트 버튼 — 관리자만 표시 */}
      {role === "admin" && (
        <button
          onClick={() => {
            localStorage.removeItem("alive-push-onboard");
            alert("초기화 완료! 새로고침하면 모달이 떠요.");
          }}
          className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm text-slate-400 transition hover:border-slate-400 hover:text-slate-500"
        >
          [테스트] 푸시 안내 모달 초기화
        </button>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Guard>
      <ProfileInner />
    </Guard>
  );
}
