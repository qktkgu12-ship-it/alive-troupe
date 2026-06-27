"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { arrayRemove, collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import Avatar from "@/components/Avatar";
import { ChevronDownIcon, PencilIcon, TrashIcon } from "@/components/Icons";
import type { Production, Role, UserProfile } from "@/lib/types";

// 역할 드롭다운 색상 (관리자=강조색 / 정단원=초록 / 대기=주황)
const ROLE_SELECT_CLASS: Record<Role, string> = {
  admin: "border-accent/20 bg-accent-soft text-accent",
  member: "border-emerald-200 bg-emerald-50 text-emerald-700",
  guest: "border-amber-200 bg-amber-50 text-amber-700",
};

// 접기/펼치기 섹션 (열림/접힘 상태를 localStorage에 저장 → 페이지 이동해도 유지)
function CollapsibleSection({
  id,
  title,
  children,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const key = `admin-collapse-${id}`;
  const [open, setOpen] = useState(true); // 기본은 펼침

  useEffect(() => {
    const v = localStorage.getItem(key);
    if (v !== null) setOpen(v === "1");
  }, [key]);

  function toggle() {
    setOpen((o) => {
      const n = !o;
      localStorage.setItem(key, n ? "1" : "0");
      return n;
    });
  }

  return (
    <section className="card">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-2 text-left">
        <h2 className="font-bold">{title}</h2>
        <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

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

  // 회원 관리 검색 (이름·배역·기수·연락처)
  const [memberSearch, setMemberSearch] = useState("");
  const approvedFiltered = useMemo(() => {
    const s = memberSearch.trim().toLowerCase();
    if (!s) return approved;
    return approved.filter((u) =>
      [u.name, u.displayName, u.part, u.group, u.contact, u.email]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(s))
    );
  }, [approved, memberSearch]);

  async function changeRole(uid: string, role: Role) {
    await setDoc(doc(db, "users", uid), { role }, { merge: true });
    load();
  }

  async function rejectUser(uid: string) {
    if (!confirm("이 단원을 삭제할까요? 가능 일정과 작품 참여명단에서도 함께 제거됩니다.")) return;
    // 이 단원이 제출한 가능 일정(availability) 모두 삭제
    const av = await getDocs(query(collection(db, "availability"), where("uid", "==", uid)));
    await Promise.all(av.docs.map((d) => deleteDoc(d.ref)));
    // 모든 작품 참여명단에서 제거
    const pr = await getDocs(query(collection(db, "productions"), where("participants", "array-contains", uid)));
    await Promise.all(pr.docs.map((d) => updateDoc(d.ref, { participants: arrayRemove(uid) })));
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

  // 전 단원의 공개 프로필(이름·배역·기수·사진)을 users 정보로 한 번에 채움
  const [syncing, setSyncing] = useState(false);
  async function syncPublicProfiles() {
    setSyncing(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const all = snap.docs.map((d) => d.data() as UserProfile);
      await Promise.all(
        all.map((u) =>
          setDoc(
            doc(db, "publicProfiles", u.uid),
            {
              name: u.name || u.displayName || "",
              part: u.part || "",
              group: u.group || "",
              avatar: u.avatar || "",
            },
            { merge: true }
          )
        )
      );
      alert(`${all.length}명의 공개 프로필을 동기화했어요! 👍`);
    } catch (e) {
      console.error(e);
      alert("동기화에 실패했어요. 보안 규칙(publicProfiles의 관리자 쓰기 허용)이 게시됐는지 확인해 주세요.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">관리</h1>

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

      {/* 회원 관리 (단원 명단 + 등급 관리 통합) */}
      <CollapsibleSection
        id="members"
        title={<>회원 관리 <span className="font-normal text-slate-400">{approved.length}명</span></>}
      >
        <input
          className="input mb-3"
          placeholder="이름 · 기수로 검색"
          value={memberSearch}
          onChange={(e) => setMemberSearch(e.target.value)}
        />
        {approved.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">아직 승인된 단원이 없습니다.</p>
        ) : approvedFiltered.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {approvedFiltered.map((u) => {
              const isMe = u.uid === user?.uid;
              return (
                <div key={u.uid} className="flex items-center gap-3 py-3">
                  <Avatar src={u.avatar} name={u.name || u.displayName} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {u.name || u.displayName} {isMe && <span className="text-xs font-normal text-slate-400">(나)</span>}
                    </p>
                    {u.group && <p className="truncate text-xs text-slate-400">{u.group}</p>}
                  </div>
                  <select
                    value={u.role}
                    disabled={isMe}
                    onChange={(e) => changeRole(u.uid, e.target.value as Role)}
                    className={`shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition disabled:cursor-default disabled:opacity-70 ${ROLE_SELECT_CLASS[u.role]}`}
                  >
                    <option value="member">정단원</option>
                    <option value="admin">관리자</option>
                    <option value="guest">준단원·게스트(대기)</option>
                  </select>
                  {!isMe ? (
                    <button
                      onClick={() => rejectUser(u.uid)}
                      aria-label="삭제"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="w-8 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* 작품 관리 */}
      <CollapsibleSection id="productions" title="작품 관리">
        <ProductionManager members={approved} />
      </CollapsibleSection>

      {/* 데이터 정리 · 설정 */}
      <CollapsibleSection id="misc" title="데이터 정리 · 설정">
        <p className="mb-1 text-sm font-semibold text-slate-700">데이터 정리</p>
        <p className="mb-3 text-sm text-slate-500">
          탈퇴한 단원이 남긴 가능 일정 데이터를 한 번에 정리합니다.
        </p>
        <button onClick={cleanupOrphans} disabled={cleaning} className="btn-ghost">
          {cleaning ? "정리 중…" : "탈퇴 단원의 잔여 가능일정 정리"}
        </button>

        <div className="mt-4">
          <p className="mb-3 text-sm text-slate-500">
            프로필 팝업에 배역·기수가 비어 보이면, 전 단원의 공개 프로필을 한 번에 채울 수 있어요.
          </p>
          <button onClick={syncPublicProfiles} disabled={syncing} className="btn-ghost">
            {syncing ? "동기화 중…" : "전 단원 공개 프로필 동기화"}
          </button>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-5">
          <SettingsCard />
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ProductionManager({ members }: { members: UserProfile[] }) {
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newGisu, setNewGisu] = useState("");
  const [editId, setEditId] = useState<string | null>(null); // 이름·기수 인라인 수정
  const [eName, setEName] = useState("");
  const [eGisu, setEGisu] = useState("");
  const [busy, setBusy] = useState(false);

  // 참여명단 모달
  const [partProd, setPartProd] = useState<Production | null>(null);
  const [mParts, setMParts] = useState<Set<string>>(new Set());
  const [mBusy, setMBusy] = useState(false);

  // 현재 진행 작품 (자료등록 기본값)
  const { settings, saveSettings } = useTheme();
  const currentId = settings.currentProductionId || "";
  function setCurrent(pid: string) {
    saveSettings({ currentProductionId: currentId === pid ? "" : pid });
  }

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
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      // 참여명단은 건드리지 않도록 이름·기수만 merge
      await setDoc(doc(db, "productions", editId), { name: eName.trim(), gisu: eGisu.trim() }, { merge: true });
      setEditId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  // ----- 참여명단 모달 -----
  function openParts(p: Production) {
    setPartProd(p);
    setMParts(new Set(p.participants || []));
  }
  function closeParts() {
    setPartProd(null);
  }
  function toggleM(uid: string) {
    setMParts((prev) => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  }
  const allSelected = members.length > 0 && members.every((m) => mParts.has(m.uid));
  function toggleAll() {
    setMParts(allSelected ? new Set() : new Set(members.map((m) => m.uid)));
  }
  async function saveParts() {
    if (!partProd) return;
    setMBusy(true);
    try {
      await setDoc(doc(db, "productions", partProd.id), { participants: [...mParts] }, { merge: true });
      closeParts();
      load();
    } finally {
      setMBusy(false);
    }
  }

  async function remove(p: Production) {
    if (!confirm(`'${p.name}' 작품을 삭제할까요? 이 작품의 음원도 함께 삭제되고, 연결된 아카이브는 '미지정'으로 바뀝니다.`)) return;
    const aud = await getDocs(query(collection(db, "audio"), where("productionId", "==", p.id)));
    await Promise.all(aud.docs.map((d) => deleteDoc(d.ref)));
    const arc = await getDocs(query(collection(db, "archives"), where("productionId", "==", p.id)));
    await Promise.all(arc.docs.map((d) => setDoc(d.ref, { productionId: null }, { merge: true })));
    await deleteDoc(doc(db, "productions", p.id));
    if (editId === p.id) setEditId(null);
    if (partProd?.id === p.id) closeParts();
    load();
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        작품마다 참여 단원을 지정하면, 그 작품의 영상·음원을 참여 단원만 보고 받을 수 있어요.
        <br />
        ★를 누르면 ‘현재 진행 작품’이 되어, 아카이브 자료 등록 시 기본으로 선택돼요.
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
        <div className="divide-y divide-slate-100">
          {productions.map((p) => (
            <div key={p.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    onClick={() => setCurrent(p.id)}
                    title="현재 진행 작품으로 설정"
                    aria-label="현재 진행 작품으로 설정"
                    className={`shrink-0 text-lg leading-none transition ${currentId === p.id ? "text-accent" : "text-slate-300 hover:text-slate-400"}`}
                  >
                    {currentId === p.id ? "★" : "☆"}
                  </button>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {p.name}
                      {p.gisu && <span className="chip ml-1.5">{p.gisu}</span>}
                      {currentId === p.id && (
                        <span className="ml-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">진행 중</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">참여 {p.participants?.length || 0}명</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openParts(p)} className="btn-ghost !py-1.5">참여명단</button>
                  <button
                    onClick={() => (editId === p.id ? setEditId(null) : startEdit(p))}
                    aria-label="수정"
                    className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
                      editId === p.id ? "border-accent/30 bg-accent-soft text-accent" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(p)}
                    aria-label="삭제"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editId === p.id && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" value={eName} onChange={(e) => setEName(e.target.value)} placeholder="작품명" />
                    <input className="input" value={eGisu} onChange={(e) => setEGisu(e.target.value)} placeholder="기수" />
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

      {/* 참여명단 모달 */}
      {partProd && (
        <div
          onClick={closeParts}
          className="fixed inset-0 z-[60] grid place-items-end bg-slate-900/40 backdrop-blur-sm sm:place-items-center sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-4">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-900">{partProd.name} 참여명단</p>
                <p className="text-xs text-slate-400">{mParts.size}명 선택됨</p>
              </div>
              <button
                onClick={toggleAll}
                disabled={members.length === 0}
                className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                {allSelected ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {members.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">승인된 단원이 없습니다.</p>
              ) : (
                members.map((m) => {
                  const checked = mParts.has(m.uid);
                  return (
                    <button
                      key={m.uid}
                      onClick={() => toggleM(m.uid)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                          checked ? "border-accent bg-accent text-accent-fg" : "border-slate-300"
                        }`}
                      >
                        {checked && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 12 5 5 9-10" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-medium text-slate-800">{m.name || m.displayName}</span>
                        {m.group && <span className="ml-1.5 text-xs text-slate-400">{m.group}</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-100 p-4">
              <button onClick={closeParts} className="btn-ghost flex-1">닫기</button>
              <button onClick={saveParts} disabled={mBusy} className="btn-accent flex-1">
                {mBusy ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsCard() {
  const { settings, saveSettings } = useTheme();
  const [troupeName, setTroupeName] = useState(settings.troupeName);
  const [accentColor, setAccentColor] = useState(settings.accentColor);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTroupeName(settings.troupeName);
    setAccentColor(settings.accentColor);
  }, [settings]);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({ troupeName, accentColor });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-700">사이트 · 테마 설정</p>
        <p className="text-sm text-slate-500">강조색을 자유롭게 바꿀 수 있어요. (전 단원에게 즉시 반영)</p>
      </div>

      <div>
        <label className="label">극단 이름</label>
        <input className="input" value={troupeName} onChange={(e) => setTroupeName(e.target.value)} />
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
          {troupeName}
        </span>
      </div>

      <button onClick={save} disabled={busy} className="btn-accent">
        {busy ? "저장 중…" : saved ? "저장됐어요 ✓" : "설정 저장"}
      </button>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Guard require="admin">
      <AdminInner />
    </Guard>
  );
}
