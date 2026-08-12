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
import EmptyState from "@/components/EmptyState";
import { FolderIcon, MusicIcon, PlusIcon, TrashIcon, XIcon } from "@/components/Icons";
import Select from "@/components/Select";
import type { AudioTrack, Production } from "@/lib/types";

const DEFAULT_CATEGORIES = ["음원", "기타"];
const DAY = 86_400_000;
const isRecent = (t: AudioTrack) => (t.createdAt ?? 0) > Date.now() - 7 * DAY;

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
  const [activeCat, setActiveCat] = useState<string>(""); // "" = 전체
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "name">("newest");
  const [showAdd, setShowAdd] = useState(false);
  const [manageCats, setManageCats] = useState(false);
  const [newCat, setNewCat] = useState("");
  // 헤더 '+' 등록 메뉴에서 들어오면(?new=1) 등록 폼을 바로 열기
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setShowAdd(true);
  }, []);

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

  // 활성 종류가 목록에서 사라지면 전체로
  useEffect(() => {
    if (activeCat !== "" && !categories.includes(activeCat)) setActiveCat("");
  }, [categories, activeCat]);

  const active = productions.find((p) => p.id === activeId) ?? null;
  const countByCat = (c: string) => items.filter((t) => itemCategory(t) === c).length;

  // 검색(작품 전체) 우선 → 없으면 종류 필터 → 정렬
  const catItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (q) {
      list = items.filter((t) =>
        [itemTitle(t), itemMemo(t), t.addedByName].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q))
      );
    } else if (activeCat) {
      list = items.filter((t) => itemCategory(t) === activeCat);
    }
    return [...list].sort((a, b) =>
      sortOrder === "newest"
        ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
        : itemTitle(a).localeCompare(itemTitle(b), "ko")
    );
  }, [items, activeCat, search, sortOrder]);

  const searching = search.trim().length > 0;

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
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">자료실</h1>

      {isAdmin && (
        <p className="text-xs leading-relaxed text-slate-400">
          💡 자료는 구글 드라이브 등에 올린 뒤 <b className="font-semibold text-slate-500">공유 링크</b>를 등록하는 방식입니다.
          파일·폴더는 <b className="font-semibold text-slate-500">‘링크가 있는 모든 사용자 — 뷰어’</b>로 공유해 두세요. (음원 한 넘버에 MR·가이드를 한 폴더로 올리면 편해요)
        </p>
      )}

      {productions.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FolderIcon}
            title="작품이 없습니다."
            hint={isAdmin ? "관리 > 작품 관리에서 추가하세요." : "관리자가 작품 참여명단에 추가하면 보여요."}
          />
        </div>
      ) : active ? (
        <div className="space-y-4">
          {/* 작품 선택 (드롭다운 — 작품이 많아져도 깔끔) */}
          <div className="flex items-center justify-between gap-2">
            <Select
              wrapperClassName="inline-block max-w-[75%]"
              className="font-semibold text-slate-800"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {productions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.gisu ? ` · ${p.gisu}` : ""}
                </option>
              ))}
            </Select>
            {isAdmin && (
              <button
                onClick={() => setShowAdd((v) => !v)}
                aria-label={showAdd ? "닫기" : "자료 추가"}
                title={showAdd ? "닫기" : "자료 추가"}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
              >
                {showAdd ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
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

          {/* 검색 (현재 작품 안 전체) */}
          <input
            className="input"
            placeholder="제목 · 메모 · 작성자로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* 종류(탭) + 정렬 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl bg-surface p-1 text-sm font-medium">
              {([["", "전체"], ...categories.map((c) => [c, c] as [string, string])] as [string, string][]).map(([val, label]) => {
                const cnt = val === "" ? items.length : countByCat(val);
                return (
                  <button
                    key={val || "all"}
                    onClick={() => setActiveCat(val)}
                    className={`rounded-lg px-3 py-1.5 transition ${activeCat === val && !searching ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
                  >
                    {label}
                    {cnt > 0 && <span className="ml-1 text-xs text-slate-400">{cnt}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 gap-1 rounded-xl bg-surface p-1 text-sm font-medium">
                {([["newest", "최신순"], ["name", "이름순"]] as ["newest" | "name", string][]).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setSortOrder(v)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition ${sortOrder === v ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {isAdmin && (
                <button onClick={() => setManageCats((v) => !v)} className="text-xs font-medium text-slate-500 hover:underline">
                  {manageCats ? "완료" : "종류 편집"}
                </button>
              )}
            </div>
          </div>

          {/* 종류 편집 패널 (관리자만) */}
          {isAdmin && manageCats && (
            <div className="card space-y-3">
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
                  placeholder="새 종류 이름"
                />
                <button onClick={addCategory} className="btn-accent shrink-0">추가</button>
              </div>
            </div>
          )}

          {/* 자료 목록 */}
          {loadingItems ? (
            <SkeletonList rows={4} />
          ) : catItems.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={MusicIcon}
                title={searching ? "검색 결과가 없습니다." : activeCat ? `‘${activeCat}’ 자료가 없습니다.` : "자료가 없습니다."}
              />
            </div>
          ) : (
            <div className="card divide-y divide-slate-100 !p-0">
              {catItems.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{itemTitle(t)}</span>
                      {isRecent(t) && (
                        <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none text-accent-fg">NEW</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {[(searching || !activeCat) ? itemCategory(t) : "", itemMemo(t), t.addedByName].filter(Boolean).join(" · ")}
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
      ) : null}
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
    <div className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Select value={cat} onChange={(e) => setCat(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      </div>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글 드라이브 등 공유 링크 (https://drive.google.com/...)" />
      <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" />
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
