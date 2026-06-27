"use client";

import { useEffect, useRef, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import Avatar from "@/components/Avatar";
import { compressImage } from "@/components/ImagePicker";

function ProfileInner() {
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string>("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [part, setPart] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setAvatar(profile.avatar || "");
      setName(profile.name || profile.displayName || "");
      setContact(profile.contact || "");
      setPart(profile.part || "");
      setGroup(profile.group || "");
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
        { avatar, name, contact, part, group },
        { merge: true }
      );
      // 단원끼리 보이는 공개 프로필도 함께 갱신 (연락처는 제외)
      await setDoc(
        doc(db, "publicProfiles", user.uid),
        { name, part, group, avatar },
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
          <label className="label">배역·파트(포지션)</label>
          <input className="input" value={part} onChange={(e) => setPart(e.target.value)} placeholder="예: 주연 / 앙상블 / 소프라노" />
        </div>
        <div>
          <label className="label">소속·기수</label>
          <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="예: 5기" />
        </div>

        <button onClick={save} disabled={busy} className="btn-accent w-full">
          {busy ? "저장 중…" : saved ? "저장됐어요 ✓" : "저장"}
        </button>
      </div>
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
