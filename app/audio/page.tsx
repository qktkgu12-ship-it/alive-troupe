"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { safeExternalUrl } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import { SkeletonList } from "@/components/Skeleton";
import { TrashIcon } from "@/components/Icons";
import type { AudioTrack, Production } from "@/lib/types";

const DEFAULT_CATEGORIES = ["음원", "기타"];

// 항상 http(s)만 새 탭으로 열기 (위험 링크 차단)
function openLink(url: string) {
  const safe = safeExternalUrl(url);
  if (safe) window.open(safe, "_blank", "noreferrer");
  else alert("열 수 없는 링크입니다. (http/https 주소만 지원)");
}

// 구버전 호환: category/title/memo 없으면 song/kind/label에서 채움
function itemCategory(t: AudioTrack) {
  return t.category || "음원";
}
function itemTitle(t: AudioTrack) {
  return t.title || t.song || "(제목 없음)";
}
function itemMemo(t: AudioTrack) {
  return t.memo || t.label || "";
}

function AudioInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const { settings, saveSettings } = useTheme();
  const categories =
    settings.resourceCategories && settings.resourceCategories.length > 0
      ? settings.resourceCategories
      : DEFAULT_CATEGORIES;

  const [productions, setProductions] = useState<Production[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<AudioTrack[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [activeCat, setActiveCat] = useState<string>(categories[0] ?? "음원");
  const [showAdd, setShowAdd] = useState(false);
  const [manageCats, setManageCats] = useState(false);
  const [newCat, setNewCat] = useState("");

  const loadProductions = useCallback(async () => {
    const q = isAdmin
      ? query(collection(db, "productions"), orderBy("order", "asc"))
      : query(collection(db, "productions"), where("participants", "array-contains", user?.uid ?? "__none__"));
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }))
      .sort((a, b) => a.order - b.order);
    setProductions(list);
    setActiveId((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
  }, [isAdmin, user?.uid]);

  const loadItems = useCallback(async (pid: string) => {
    setLoadingItems(true);
    try {
      const snap = await getDocs(query(collection(db, "audio"), where("productionId", "==", pid)));
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AudioTrack, "id">) })));
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    loadProductions();
  }, [loadProductions]);

  useEffect(() => {
    if (activeId) loadItems(activeId);
    else setItems([]);
  }, [activeId, loadItems]);

  // 활성 종류가 목록에서 사라지면 첫 종류로
  useEffect(() => {
    if (!categories.includes(activeCat)) setActiveCat(categories[0] ?? "음원");
  }, [categories, activeCat]);

  const active = productions.find((p) => p.id === activeId) ?? null;
  const countByCat = (c: string) => items.filter((t) => itemCategory(t) === c).length;
  const catItems = useMemo(
    () =>
      items
        .filter((t) => itemCategory(t) === activeCat)
        .sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), "ko")),
    [items, activeCat]
  );

  async function removeItem(t: AudioTrack) {
    if (!confirm("이 자료를 삭제할까요?")) return;
    await deleteDoc(doc(db, "audio", t.id));
    if (activeId) loadItems(activeId);
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    if (categories.includes(name)) {
      alert("이미 있는 종류예요.");
      return;
    }
    await saveSettings({ resourceCategories: [...categories, name] });
    setNewCat("");
    setActiveCat(name);
  }

  async function removeCategory(c: string) {
    const cnt = countByCat(c);
    const msg =
      cnt > 0
        ? `'${c}' 종류에 자료 ${cnt}개가 있어요. 탭을 지우면 그 자료들은 목록에서 숨겨집니다(완전 삭제는 아님). 계속할까요?`
        : `'${c}' 종류를 삭제할까요?`;
    if (!confirm(msg)) return;
    await saveSettings({ resourceCategories: categories.filter((x) => x !== c) });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">자료실</h1>

      {isAdmin && (
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
          💡 자료는 구글 드라이브 등에 올린 뒤 <b>공유 링크</b>를 등록하는 방식입니다.
          파일·폴더는 <b>‘링크가 있는 모든 사용자 — 뷰어’</b>로 공유해 두세요. (음원 한 넘버에 MR·가이드를 한 폴더로 올리면 편해요)
        </div>
      )}

      {/* 작품(폴더) 탭 — 참여 중인 작품만 표시 */}
      {productions.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">
          {isAdmin
            ? "작품이 없습니다. 관리 > 작품 관리에서 추가하세요."
            : "참여 중인 작품이 없습니다. (관리자가 작품 참여명단에 추가하면 보여요)"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {productions.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeId === p.id ? "bg-accent text-accent-fg" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-700">{active.name}</h2>
              {active.gisu && <span className="chip">{active.gisu}</span>}
            </div>
            {isAdmin && (
              <button onClick={() => setShowAdd((v) => !v)} className="btn-accent !py-1.5">
                {showAdd ? "닫기" : "+ 자료 추가"}
              </button>
            )}
          </div>

          {/* 자료 추가 (관리자만) */}
          {isAdmin && showAdd && (
            <AddForm
              productionId={active.id}
              categories={categories}
              defaultCat={activeCat}
              addedByName={profile?.name || profile?.displayName || ""}
              onAdded={() => {
                setShowAdd(false);
                loadItems(active.id);
              }}
            />
          )}

          {/* 종류(탭) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl bg-surface p-1 text-sm font-medium">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  className={`rounded-lg px-3 py-1.5 transition ${activeCat === c ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
                >
                  {c}
                  {countByCat(c) > 0 && <span className="ml-1 text-xs text-slate-400">{countByCat(c)}</span>}
                </button>
              ))}
            </div>
            {isAdmin && (
              <button onClick={() => setManageCats((v) => !v)} className="text-xs font-medium text-slate-500 hover:underline">
                {manageCats ? "완료" : "종류 편집"}
              </button>
            )}
          </div>

          {/* 종류 편집 패널 (관리자만) */}
          {isAdmin && manageCats && (
            <div className="card space-y-3 border-dashed">
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                    {c}
                    <button
                      onClick={() => removeCategory(c)}
                      disabled={categories.length <= 1}
                      aria-label={`${c} 삭제`}
                      className="text-slate-400 transition hover:text-red-500 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCategory();
                  }}
                  placeholder="새 종류 이름 (예: 악보, 대본, 안무)"
                />
                <button onClick={addCategory} className="btn-accent shrink-0">추가</button>
              </div>
            </div>
          )}

          {/* 자료 목록 */}
          {loadingItems ? (
            <SkeletonList rows={4} />
          ) : catItems.length === 0 ? (
            <p className="card py-8 text-center text-slate-400">‘{activeCat}’ 자료가 없습니다.</p>
          ) : (
            <div className="card divide-y divide-slate-100 !p-0">
              {catItems.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{itemTitle(t)}</p>
                    <p className="truncate text-xs text-slate-400">
                      {[itemMemo(t), t.addedByName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button onClick={() => openLink(t.url)} className="btn-ghost shrink-0 !px-3 !py-1.5">
                    열기 ↗
                  </button>
                  {isAdmin && (
                    <button onClick={() => removeItem(t)} aria-label="삭제" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500">
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddForm({
  productionId,
  categories,
  defaultCat,
  addedByName,
  onAdded,
}: {
  productionId: string;
  categories: string[];
  defaultCat: string;
  addedByName: string;
  onAdded: () => void;
}) {
  const [cat, setCat] = useState(defaultCat);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCat(defaultCat);
  }, [defaultCat]);

  async function add() {
    if (!title.trim() || !url.trim()) {
      alert("제목과 링크는 필수입니다.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await setDoc(doc(db, "audio", id), {
        productionId,
        category: cat,
        title: title.trim(),
        memo: memo.trim(),
        url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`,
        addedByName,
        createdAt: Date.now(),
      });
      setTitle("");
      setUrl("");
      setMemo("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 border-dashed">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (예: 넘버명 / 악보명 / 문서명)" />
      </div>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글 드라이브 등 공유 링크 (https://drive.google.com/...)" />
      <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택) — 예: 2키 다운 / 1막용" />
      <button onClick={add} disabled={busy} className="btn-accent w-full">
        {busy ? "추가 중…" : "자료 추가"}
      </button>
    </div>
  );
}

export default function AudioPage() {
  return (
    <Guard>
      <AudioInner />
    </Guard>
  );
}
