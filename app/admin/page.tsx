"use client";

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import type { Role, UserProfile } from "@/lib/types";

const PRESET_COLORS = [
  { name: "보라 (넥스트 투 노멀)", hex: "#7c3aed" },
  { name: "빨강 (데스노트)", hex: "#dc2626" },
  { name: "파랑", hex: "#2563eb" },
  { name: "초록", hex: "#059669" },
  { name: "분홍", hex: "#db2777" },
  { name: "주황", hex: "#ea580c" },
  { name: "남색", hex: "#1e293b" },
  { name: "청록", hex: "#0d9488" },
];

function AdminInner() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "asc")));
      setUsers(snap.docs.map((d) => d.data() as UserProfile));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const pending = users.filter((u) => u.role === "guest");
  const approved = users.filter((u) => u.role !== "guest");

  async function changeRole(uid: string, role: Role) {
    await setDoc(doc(db, "users", uid), { role }, { merge: true });
    load();
  }

  async function rejectUser(uid: string) {
    if (!confirm("이 단원을 삭제할까요? 해당 단원이 등록한 가능 일정도 함께 삭제됩니다.")) return;
    // 이 단원이 제출한 가능 일정(availability) 모두 삭제
    const av = await getDocs(query(collection(db, "availability"), where("uid", "==", uid)));
    await Promise.all(av.docs.map((d) => deleteDoc(d.ref)));
    // 회원 문서 삭제
    await deleteDoc(doc(db, "users", uid));
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">관리자</h1>

      {/* 사이트 설정 */}
      <SettingsCard />

      {/* 승인 대기 */}
      <section className="card">
        <h2 className="mb-1 font-bold">
          승인 대기 <span className="text-accent">{pending.length}</span>
        </h2>
        <p className="mb-3 text-sm text-slate-500">
          승인하면 ‘정단원’이 되어 모든 기능을 이용할 수 있습니다.
        </p>
        {loading ? (
          <p className="py-6 text-center text-slate-400">불러오는 중…</p>
        ) : pending.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">대기 중인 신청이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.uid} className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name || u.displayName || u.email}</p>
                  <p className="text-xs text-slate-500">
                    {[u.email, u.part, u.group, u.contact].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button onClick={() => changeRole(u.uid, "member")} className="btn-accent !py-1.5">승인 (정단원)</button>
                <button onClick={() => rejectUser(u.uid)} className="btn-danger">거절</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 회원 등급 관리 */}
      <section className="card">
        <h2 className="mb-3 font-bold">회원 등급 관리 <span className="text-slate-400">{approved.length}명</span></h2>
        {approved.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">아직 승인된 단원이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {approved.map((u) => {
              const isMe = u.uid === user?.uid;
              return (
                <div key={u.uid} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {u.name || u.displayName} {isMe && <span className="text-xs text-slate-400">(나)</span>}
                    </p>
                    <p className="text-xs text-slate-500">{[u.email, u.part, u.group].filter(Boolean).join(" · ")}</p>
                  </div>
                  <select
                    value={u.role}
                    disabled={isMe}
                    onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                    className="input !w-auto !py-1.5 text-sm disabled:opacity-50"
                  >
                    <option value="member">정단원</option>
                    <option value="admin">관리자</option>
                    <option value="guest">준단원·게스트(대기)</option>
                  </select>
                  {!isMe && (
                    <button onClick={() => rejectUser(u.uid)} className="btn-danger">삭제</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsCard() {
  const { settings, saveSettings } = useTheme();
  const [troupeName, setTroupeName] = useState(settings.troupeName);
  const [currentProduction, setCurrentProduction] = useState(settings.currentProduction);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTroupeName(settings.troupeName);
    setCurrentProduction(settings.currentProduction);
    setAccentColor(settings.accentColor);
  }, [settings]);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({ troupeName, currentProduction, accentColor });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-bold">사이트 · 테마 설정</h2>
        <p className="text-sm text-slate-500">현재 공연에 맞춰 강조색을 자유롭게 바꿀 수 있어요. (전 단원에게 즉시 반영)</p>
      </div>

      <div>
        <label className="label">극단 이름</label>
        <input className="input" value={troupeName} onChange={(e) => setTroupeName(e.target.value)} />
      </div>

      <div>
        <label className="label">현재 공연명 (상단에 표시)</label>
        <input className="input" value={currentProduction} onChange={(e) => setCurrentProduction(e.target.value)} placeholder="예: 넥스트 투 노멀" />
      </div>

      <div>
        <label className="label">강조색</label>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.hex}
              title={c.name}
              onClick={() => setAccentColor(c.hex)}
              className={`h-9 w-9 rounded-full ring-offset-2 transition ${accentColor.toLowerCase() === c.hex.toLowerCase() ? "ring-2 ring-slate-800" : ""}`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-sm text-slate-500">
            직접 선택
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" />
          </label>
        </div>
      </div>

      {/* 미리보기 */}
      <div className="flex items-center gap-3 rounded-xl p-4" style={{ backgroundColor: accentColor }}>
        <span className="font-bold" style={{ color: parseInt(accentColor.replace("#", ""), 16) > 0x888888 ? "#111" : "#fff" }}>
          {troupeName} {currentProduction && `· ${currentProduction}`}
        </span>
      </div>

      <button onClick={save} disabled={busy} className="btn-accent">
        {busy ? "저장 중…" : saved ? "저장됐어요 ✓" : "설정 저장"}
      </button>
    </section>
  );
}

export default function AdminPage() {
  return (
    <Guard require="admin">
      <AdminInner />
    </Guard>
  );
}
