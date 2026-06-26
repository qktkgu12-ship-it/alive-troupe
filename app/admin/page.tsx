"use client";

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import type { Production, Role, UserProfile } from "@/lib/types";

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

  // 탈퇴한(목록에 없는) 단원이 남긴 가능 일정 일괄 정리
  const [cleaning, setCleaning] = useState(false);
  async function cleanupOrphans() {
    setCleaning(true);
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const ids = new Set(usersSnap.docs.map((d) => d.id));
      const avSnap = await getDocs(collection(db, "availability"));
      const orphans = avSnap.docs.filter((d) => !ids.has((d.data() as { uid: string }).uid));
      if (orphans.length === 0) {
        alert("정리할 잔여 데이터가 없습니다. 👍");
        return;
      }
      if (!confirm(`탈퇴한 단원이 남긴 가능 일정 ${orphans.length}건을 삭제할까요?`)) return;
      await Promise.all(orphans.map((d) => deleteDoc(d.ref)));
      alert(`${orphans.length}건 정리 완료!`);
    } catch (e) {
      console.error(e);
      alert("정리에 실패했어요. 보안 규칙(Firestore)이 최신으로 게시됐는지 확인해 주세요.");
    } finally {
      setCleaning(false);
    }
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

      {/* 작품 관리 */}
      <ProductionManager members={approved} />

      {/* 데이터 정리 */}
      <section className="card">
        <h2 className="mb-1 font-bold">데이터 정리</h2>
        <p className="mb-3 text-sm text-slate-500">
          탈퇴한 단원이 남긴 가능 일정 데이터를 한 번에 정리합니다.
        </p>
        <button onClick={cleanupOrphans} disabled={cleaning} className="btn-ghost">
          {cleaning ? "정리 중…" : "탈퇴 단원의 잔여 가능일정 정리"}
        </button>
      </section>
    </div>
  );
}

function ProductionManager({ members }: { members: UserProfile[] }) {
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newGisu, setNewGisu] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eGisu, setEGisu] = useState("");
  const [eParts, setEParts] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "productions"), orderBy("order", "asc")));
      setProductions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) })));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!newName.trim()) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, "productions", id), {
      name: newName.trim(),
      gisu: newGisu.trim(),
      participants: [],
      order: productions.length,
      createdAt: Date.now(),
    });
    setNewName("");
    setNewGisu("");
    load();
  }

  function startEdit(p: Production) {
    setEditId(p.id);
    setEName(p.name);
    setEGisu(p.gisu || "");
    setEParts(new Set(p.participants || []));
  }

  function toggle(uid: string) {
    setEParts((prev) => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "productions", editId),
        { name: eName.trim(), gisu: eGisu.trim(), participants: [...eParts] },
        { merge: true }
      );
      setEditId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Production) {
    if (!confirm(`'${p.name}' 작품을 삭제할까요? 이 작품의 음원도 함께 삭제되고, 연결된 아카이빙은 '미지정'으로 바뀝니다.`)) return;
    const aud = await getDocs(query(collection(db, "audio"), where("productionId", "==", p.id)));
    await Promise.all(aud.docs.map((d) => deleteDoc(d.ref)));
    const arc = await getDocs(query(collection(db, "archives"), where("productionId", "==", p.id)));
    await Promise.all(arc.docs.map((d) => setDoc(d.ref, { productionId: null }, { merge: true })));
    await deleteDoc(doc(db, "productions", p.id));
    if (editId === p.id) setEditId(null);
    load();
  }

  return (
    <section className="card">
      <h2 className="mb-1 font-bold">작품 관리</h2>
      <p className="mb-3 text-sm text-slate-500">
        작품마다 참여 단원을 지정하면, 그 작품의 영상·음원을 참여 단원만 보고 받을 수 있어요.
      </p>

      {/* 새 작품 추가 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input min-w-[140px] flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 작품명 (예: 넥스트 투 노멀)" />
        <input className="input w-24" value={newGisu} onChange={(e) => setNewGisu(e.target.value)} placeholder="기수" />
        <button onClick={create} className="btn-accent">추가</button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : productions.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">아직 작품이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {productions.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {p.name}
                    {p.gisu && <span className="chip ml-1.5">{p.gisu}</span>}
                  </p>
                  <p className="text-xs text-slate-400">참여 {p.participants?.length || 0}명</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => (editId === p.id ? setEditId(null) : startEdit(p))} className="btn-ghost !py-1.5">
                    {editId === p.id ? "접기" : "참여명단"}
                  </button>
                  <button onClick={() => remove(p)} className="btn-danger">삭제</button>
                </div>
              </div>

              {editId === p.id && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" value={eName} onChange={(e) => setEName(e.target.value)} placeholder="작품명" />
                    <input className="input" value={eGisu} onChange={(e) => setEGisu(e.target.value)} placeholder="기수" />
                  </div>
                  <div>
                    <p className="label">참여 단원 (체크한 사람만 접근 가능)</p>
                    {members.length === 0 ? (
                      <p className="text-sm text-slate-400">승인된 단원이 없습니다.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                        {members.map((m) => (
                          <label key={m.uid} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={eParts.has(m.uid)}
                              onChange={() => toggle(m.uid)}
                              className="h-4 w-4 accent-[rgb(var(--accent))]"
                            />
                            <span className="truncate">
                              {m.name || m.displayName}
                              {m.group ? ` · ${m.group}` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={saveEdit} disabled={busy} className="btn-accent w-full">
                    {busy ? "저장 중…" : "저장"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
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
