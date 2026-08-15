"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { relativeTime, safeExternalUrl } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import { SkeletonList } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { CheckIcon, DotsVerticalIcon, FolderIcon, LinkIcon, MusicIcon, PencilIcon, PlusIcon, ShareIcon, TrashIcon, XIcon } from "@/components/Icons";
import Select from "@/components/Select";
import BottomSheet from "@/components/BottomSheet";
import AudioForm from "@/components/forms/AudioForm";
import { useCreateSheet } from "@/lib/create-sheet-context";
import type { AudioTrack, Production } from "@/lib/types";

const DEFAULT_CATEGORIES = ["음원", "기타"];
const DEFAULT_CAT_EMOJIS: Record<string, string> = { "음원": "🎵", "기타": "📁" };
const DAY = 86_400_000;
const isRecent = (t: AudioTrack) => (t.createdAt ?? 0) > Date.now() - 7 * DAY;

function openLink(url: string) {
  const safe = safeExternalUrl(url);
  if (safe) window.open(safe, "_blank", "noreferrer");
  else alert("열 수 없는 링크입니다. (http/https 주소만 지원)");
}

// 액션시트용 복사 행
function CopyActionRow({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
    >
      {copied
        ? <CheckIcon className="h-5 w-5 shrink-0 text-green-500" />
        : <LinkIcon className="h-5 w-5 shrink-0 text-slate-500" />}
      <span className={`text-[15px] ${copied ? "text-green-500" : "text-slate-800"}`}>
        {copied ? "복사됨!" : label}
      </span>
    </button>
  );
}

// 구버전 호환
function itemCategory(t: AudioTrack) { return t.category || "음원"; }
function itemTitle(t: AudioTrack) { return t.title || t.song || "(제목 없음)"; }
function itemMemo(t: AudioTrack) { return t.memo || t.label || ""; }

function AudioInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const { settings, saveSettings } = useTheme();

  const categories =
    settings.resourceCategories && settings.resourceCategories.length > 0
      ? settings.resourceCategories
      : DEFAULT_CATEGORIES;

  const catEmojis = settings.resourceCategoryEmojis ?? {};
  const getEmoji = (cat: string) => catEmojis[cat] ?? DEFAULT_CAT_EMOJIS[cat] ?? "📄";

  const [productions, setProductions] = useState<Production[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<AudioTrack[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [activeCat, setActiveCat] = useState<string>("");
  const [search, setSearch] = useState("");
  const sortOrder = "newest";
  const [showAdd, setShowAdd] = useState(false);
  const [manageCats, setManageCats] = useState(false);
  const audioFormRef = useRef<(() => void) | null>(null);
  const [newCat, setNewCat] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("");

  // 더보기 액션시트
  const [actionItem, setActionItem] = useState<AudioTrack | null>(null);
  const [editItem, setEditItem] = useState<AudioTrack | null>(null);
  const editFormRef = useRef<(() => void) | null>(null);

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

  useEffect(() => { loadProductions(); }, [loadProductions]);
  useEffect(() => { if (activeId) loadItems(activeId); else setItems([]); }, [activeId, loadItems]);

  const { createdAt } = useCreateSheet();
  useEffect(() => {
    if (createdAt?.kind === "audio" && activeId) loadItems(activeId);
  }, [createdAt, activeId, loadItems]);

  useEffect(() => {
    if (activeCat !== "" && !categories.includes(activeCat)) setActiveCat("");
  }, [categories, activeCat]);

  const active = productions.find((p) => p.id === activeId) ?? null;
  const countByCat = (c: string) => items.filter((t) => itemCategory(t) === c).length;

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
    setActionItem(null);
    if (activeId) loadItems(activeId);
  }

  async function addCategory() {
    const name = newCat.trim();
    const emoji = newCatEmoji.trim();
    if (!name) return;
    if (categories.includes(name)) { alert("이미 있는 종류예요."); return; }
    const updates: Parameters<typeof saveSettings>[0] = { resourceCategories: [...categories, name] };
    if (emoji) updates.resourceCategoryEmojis = { ...catEmojis, [name]: emoji };
    await saveSettings(updates);
    setNewCat("");
    setNewCatEmoji("");
    setActiveCat(name);
  }

  async function removeCategory(c: string) {
    const cnt = countByCat(c);
    const msg = cnt > 0
      ? `'${c}' 종류에 자료 ${cnt}개가 있어요. 탭을 지우면 그 자료들은 목록에서 숨겨집니다. 계속할까요?`
      : `'${c}' 종류를 삭제할까요?`;
    if (!confirm(msg)) return;
    const newEmojis = { ...catEmojis };
    delete newEmojis[c];
    await saveSettings({
      resourceCategories: categories.filter((x) => x !== c),
      resourceCategoryEmojis: newEmojis,
    });
  }

  async function shareUrl(url: string, title: string) {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
      alert("링크를 클립보드에 복사했습니다.");
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">자료실</h1>

      <p className="text-xs leading-relaxed text-slate-400">
        💡 자료는 구글 드라이브 등에 올린 뒤 <b className="font-semibold text-slate-500">공유 링크</b>를 등록하는 방식입니다.
      </p>

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
          {/* 작품 선택 */}
          <div className="flex items-center justify-between gap-2">
            <Select
              wrapperClassName="inline-block max-w-[75%]"
              className="font-semibold text-slate-800"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {productions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.gisu ? ` · ${p.gisu}` : ""}</option>
              ))}
            </Select>
            <button
              onClick={() => setShowAdd((v) => !v)}
              aria-label={showAdd ? "닫기" : "자료 추가"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
            >
              {showAdd ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
            </button>
          </div>

          {/* 자료 추가 바텀시트 */}
          <BottomSheet open={showAdd} title="자료실 등록" onClose={() => setShowAdd(false)} onConfirm={() => audioFormRef.current?.()}>
            <AudioForm
              productionId={active.id}
              categories={categories}
              defaultCat={activeCat || categories[0]}
              addedByName={profile?.name || profile?.displayName || ""}
              onAdded={() => { setShowAdd(false); loadItems(active.id); }}
              onCancel={() => setShowAdd(false)}
              submitRef={audioFormRef}
            />
          </BottomSheet>

          {/* 자료 수정 바텀시트 — 관리자만 */}
          {isAdmin && (
            <BottomSheet open={!!editItem} title="자료 수정" onClose={() => setEditItem(null)} onConfirm={() => editFormRef.current?.()}>
              {editItem && (
                <AudioForm
                  key={editItem.id}
                  productionId={active.id}
                  categories={categories}
                  defaultCat={activeCat || categories[0]}
                  addedByName={profile?.name || profile?.displayName || ""}
                  onAdded={() => { setEditItem(null); loadItems(active.id); }}
                  onCancel={() => setEditItem(null)}
                  submitRef={editFormRef}
                  edit={editItem}
                />
              )}
            </BottomSheet>
          )}

          {/* 검색 */}
          <input
            className="input"
            placeholder="제목 · 메모 · 작성자로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* 종류 칩 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {([["", "전체"], ...categories.map((c) => [c, c] as [string, string])] as [string, string][]).map(([val, label]) => (
                <button
                  key={val || "all"}
                  onClick={() => setActiveCat(val)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition ${activeCat === val && !searching ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}
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

          {/* 종류 편집 패널 */}
          {isAdmin && manageCats && (
            <div className="card space-y-3">
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                    {getEmoji(c)} {c}
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
                  className="input w-14 shrink-0 text-center text-lg"
                  value={newCatEmoji}
                  onChange={(e) => setNewCatEmoji(e.target.value)}
                  placeholder="🎵"
                  maxLength={2}
                />
                <input
                  className="input flex-1"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
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
                title={searching ? "검색 결과가 없습니다." : activeCat ? `'${activeCat}' 자료가 없습니다.` : "자료가 없습니다."}
              />
            </div>
          ) : (
            <div className="space-y-1">
              {catItems.map((t) => (
                <div
                  key={t.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => openLink(t.url)}
                  onKeyDown={(e) => { if (e.key === "Enter") openLink(t.url); }}
                  className="card flex cursor-pointer items-center gap-3 !p-3 transition hover:ring-1 hover:ring-accent/30"
                >
                  <span className="text-2xl">{getEmoji(itemCategory(t))}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-medium text-slate-900">
                      <span className="truncate">{itemTitle(t)}</span>
                      {isRecent(t) && (
                        <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none text-accent-fg">NEW</span>
                      )}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                      {itemMemo(t) && <span className="text-slate-500">{itemMemo(t)}</span>}
                      {itemMemo(t) && <span>·</span>}
                      <span className="text-slate-500">{t.addedByName}</span>
                      {t.createdAt && <><span>·</span><span>{relativeTime(t.createdAt)}</span></>}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActionItem(t); }}
                    aria-label="더보기"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <DotsVerticalIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ⋮ 액션시트 */}
      <BottomSheet open={!!actionItem} title={actionItem ? itemTitle(actionItem) : ""} onClose={() => setActionItem(null)}>
        {actionItem && (
          <div className="space-y-0.5">
            <CopyActionRow url={actionItem.url} label="링크 복사" />

            <button
              onClick={() => shareUrl(actionItem.url, itemTitle(actionItem))}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
            >
              <ShareIcon className="h-5 w-5 shrink-0 text-slate-500" />
              <span className="text-[15px] text-slate-800">공유</span>
            </button>

            {isAdmin && (
              <>
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={() => { setEditItem(actionItem); setActionItem(null); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                >
                  <PencilIcon className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="text-[15px] text-slate-800">수정</span>
                </button>
                <button
                  onClick={() => removeItem(actionItem)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-red-50"
                >
                  <TrashIcon className="h-5 w-5 shrink-0 text-red-400" />
                  <span className="text-[15px] text-red-500">삭제</span>
                </button>
              </>
            )}
          </div>
        )}
      </BottomSheet>
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
