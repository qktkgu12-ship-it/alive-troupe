"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import { SkeletonCards } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import Select from "@/components/Select";
import BottomSheet from "@/components/BottomSheet";
import ArchiveForm, { itemClips } from "@/components/forms/ArchiveForm";
import { useCreateSheet } from "@/lib/create-sheet-context";
import {
  ArchiveIcon,
  CalendarIcon,
  CheckIcon,
  DotsVerticalIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  TrashIcon,
  XIcon,
} from "@/components/Icons";
import {
  ARCHIVE_KIND_EMOJI,
  type ArchiveClip,
  type ArchiveItem,
  type ArchiveKind,
  type Production,
} from "@/lib/types";
import { chunk, safeExternalUrl } from "@/lib/utils";

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

// 재생 칩 (카드/리스트에 표시, 탭하면 바로 열기)
function ClipChips({ clips }: { clips: ArchiveClip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {clips.map((c, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); openLink(c.url); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-95"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3 2l7 4-7 4z" />
          </svg>
          {c.label || `영상 ${i + 1}`}
        </button>
      ))}
    </div>
  );
}

function ArchiveInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";

  const [productions, setProductions] = useState<Production[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ArchiveKind | "all">("all");
  const [prodFilter, setProdFilter] = useState<string>("all"); // "all" | productionId
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<ArchiveItem | null>(null);
  const archiveFormRef = useRef<(() => void) | null>(null);

  // 더보기 액션시트
  const [actionItem, setActionItem] = useState<ArchiveItem | null>(null);
  // 영상 선택 서브시트 (다수 영상일 때 복사/공유 대상 선택)
  const [clipPicker, setClipPicker] = useState<{ mode: "copy" | "share"; clips: ArchiveClip[]; title: string } | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setShowForm(true);
  }, []);

  // 홈 카드에서 넘어온 딥링크 — 그 자료를 찾아가 잠깐 강조한다.
  // 이미 /archive에 있을 때 눌러도 반응해야 하므로 useSearchParams로 본다.
  const searchParams = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const it = searchParams.get("item");
    if (!it) return;
    // 걸려 있던 필터에 가려 안 보일 수 있으니 풀어 준다
    setSearch("");
    setKindFilter("all");
    setProdFilter("all");
    setHighlightId(it);
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [searchParams]);

  const [view, setViewState] = useState<ViewMode>("list");
  useEffect(() => {
    if (!user) return;
    try {
      const v = localStorage.getItem(`archive-view-${user.uid}`);
      if (v === "card" || v === "list") setViewState(v);
    } catch { /* 무시 */ }
  }, [user]);
  function setView(v: ViewMode) {
    setViewState(v);
    try { if (user) localStorage.setItem(`archive-view-${user.uid}`, v); } catch { /* 무시 */ }
  }

  const sortOrder = "newest";
  const PAGE = 30;
  const [visible, setVisible] = useState(PAGE);

  const prodMap = useMemo(() => new Map(productions.map((p) => [p.id, p])), [productions]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 관리자: 모든 작품 / 일반: 참여명단에 포함된 작품만
      const pq = isAdmin
        ? query(collection(db, "productions"), orderBy("order", "asc"))
        : query(collection(db, "productions"), where("participants", "array-contains", user.uid));
      const psnap = await getDocs(pq);
      const prods = psnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }));
      setProductions(prods);

      // 아카이브: 관리자는 전체, 일반은 참여 중인 productionId에 속한 것만
      let allItems: ArchiveItem[];
      if (isAdmin) {
        const snap = await getDocs(query(collection(db, "archives"), orderBy("date", "desc")));
        allItems = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) }));
      } else {
        const myProdIds = prods.map((p) => p.id);
        if (myProdIds.length === 0) {
          allItems = [];
        } else {
          // Firestore 'in' 연산자는 최대 30개 → chunk 처리 (orderBy 제거 — JS 정렬로 대체, 복합 인덱스 불필요)
          const batches = chunk(myProdIds, 30).map((ids) =>
            getDocs(query(collection(db, "archives"), where("productionId", "in", ids)))
          );
          const snaps = await Promise.all(batches);
          allItems = snaps
            .flatMap((s) => s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) })))
            .sort((a, b) => b.date.localeCompare(a.date));
        }
      }
      setItems(allItems);
    } catch (e) {
      console.error("아카이브 불러오기 오류:", e);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const { createdAt } = useCreateSheet();
  useEffect(() => { if (createdAt?.kind === "archive") load(); }, [createdAt, load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (prodFilter !== "all" && it.productionId !== prodFilter) return false;
      if (!s) return true;
      const prodName = it.productionId ? prodMap.get(it.productionId)?.name ?? "" : "";
      return it.title.toLowerCase().includes(s) || it.description.toLowerCase().includes(s) || prodName.toLowerCase().includes(s);
    });
  }, [items, search, kindFilter, prodFilter, prodMap]);

  const sorted = useMemo(() => {
    const dir = sortOrder === "newest" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const byDate = (a.date || "").localeCompare(b.date || "") * dir;
      if (byDate !== 0) return byDate;
      return (a.title || "").localeCompare(b.title || "", "ko");
    });
  }, [filtered, sortOrder]);

  useEffect(() => { setVisible(PAGE); }, [search, kindFilter, prodFilter, sortOrder]);

  // 딥링크로 지목된 자료까지 스크롤. 목록 뒤쪽에 있으면 그만큼 더 펼친다.
  useEffect(() => {
    if (!highlightId) return;
    const idx = sorted.findIndex((it) => it.id === highlightId);
    if (idx < 0) return;
    if (idx >= visible) {
      setVisible(Math.ceil((idx + 1) / PAGE) * PAGE);
      return; // 다시 그려진 뒤에 스크롤한다
    }
    const el = document.getElementById(`ar-${highlightId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, sorted, visible]);

  async function removeItem(it: ArchiveItem) {
    if (!confirm("이 자료를 삭제할까요?")) return;
    await deleteDoc(doc(db, "archives", it.id));
    setActionItem(null);
    load();
  }

  async function changeProduction(it: ArchiveItem, pid: string) {
    await setDoc(doc(db, "archives", it.id), { productionId: pid || null }, { merge: true });
    load();
  }

  const canEdit = (it: ArchiveItem) => isAdmin || it.createdBy === user?.uid;
  const canDelete = (it: ArchiveItem) => isAdmin || it.createdBy === user?.uid;
  const prodLabel = (it: ArchiveItem) => (it.productionId ? prodMap.get(it.productionId)?.name ?? "삭제된 작품" : "미지정");

  // 공유
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
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">아카이브</h1>

      <p className="flex items-start gap-1 text-xs leading-relaxed text-slate-400">
        <span aria-hidden className="shrink-0">💡</span>
          <span>공연·연습 영상을 기록으로 남겨보세요. 링크를 등록하면 팀원 모두가 볼 수 있어요.</span>
      </p>

      {/* 등록·수정 바텀시트 */}
      <BottomSheet
        open={showForm || !!editItem}
        title={editItem ? "자료 수정" : "자료 등록"}
        onClose={() => { setShowForm(false); setEditItem(null); }}
        onConfirm={() => archiveFormRef.current?.()}
      >
        <ArchiveForm
          key={editItem?.id ?? "new"}
          edit={editItem ?? undefined}
          productions={productions}
          isAdmin={isAdmin}
          onSaved={() => { setShowForm(false); setEditItem(null); load(); }}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
          author={{ uid: user?.uid ?? "", name: profile?.name || profile?.displayName || "" }}
          submitRef={archiveFormRef}
        />
      </BottomSheet>

      {/* 검색 / 필터 — 자료실과 동일한 레이아웃 */}
      <div className="space-y-4">
        {/* 작품 Select + 등록 버튼 */}
        <div className="flex items-center justify-between gap-2">
          {productions.length > 0 ? (
            <Select
              wrapperClassName="inline-block max-w-[75%]"
              value={prodFilter}
              onChange={(e) => setProdFilter(e.target.value)}
              className="font-semibold text-slate-800"
            >
              <option value="all">전체 작품</option>
              {productions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.gisu ? ` · ${p.gisu}` : ""}</option>
              ))}
            </Select>
          ) : (
            <span />
          )}
          <button
            onClick={() => {
              if (showForm || editItem) { setShowForm(false); setEditItem(null); }
              else setShowForm(true);
            }}
            aria-label={showForm || editItem ? "닫기" : "자료 등록"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
          >
            {showForm || editItem ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
          </button>
        </div>

        {/* 검색 */}
        <input
          className="input"
          placeholder="검색할 단어 입력"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* 종류 필터 칩 + 뷰 토글 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {([["all", "전체"], ["rehearsal", "연습"], ["performance", "공연"], ["etc", "기타"]] as [ArchiveKind | "all", string][]).map(
              ([k, label]) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition ${kindFilter === k ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  {label}
                </button>
              )
            )}
          </div>
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <SkeletonCards />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState icon={ArchiveIcon} title="자료가 없습니다." />
        </div>
      ) : view === "card" ? (
        /* ===== 카드 보기 ===== */
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.slice(0, visible).map((it) => {
              const clips = itemClips(it);
              const multi = clips.length > 1;
              return (
                <div
                  key={it.id}
                  id={`ar-${it.id}`}
                  role={multi ? undefined : "link"}
                  tabIndex={multi ? undefined : 0}
                  onClick={() => { if (!multi && clips[0]) openLink(clips[0].url); }}
                  onKeyDown={(e) => { if (!multi && clips[0] && e.key === "Enter") openLink(clips[0].url); }}
                  className={`card flex flex-col !p-4 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)] ${multi ? "" : "cursor-pointer hover:ring-1 hover:ring-accent/30"} ${highlightId === it.id ? "ring-2 ring-accent" : ""}`}
                >
                  {/* 헤더 행: 이모지 + 날짜 + ⋮ */}
                  <div className="mb-2 flex items-center gap-2">
                    <span className="tf text-xl">{ARCHIVE_KIND_EMOJI[it.kind]}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {it.date}
                    </span>
                    {multi && <span className="ml-auto text-xs font-semibold text-slate-400">영상 {clips.length}개</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionItem(it); }}
                      aria-label="더보기"
                      className={`${multi ? "" : "ml-auto"} grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700`}
                    >
                      <DotsVerticalIcon className="h-4 w-4" />
                    </button>
                  </div>

                  <h3 className="font-semibold">{it.title}</h3>
                  {it.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{it.description}</p>}
                  {multi && <div className="mt-3"><ClipChips clips={clips} /></div>}

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {isAdmin ? (
                      <select
                        value={it.productionId ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => changeProduction(it, e.target.value)}
                        className="max-w-[80%] rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      >
                        <option value="">미지정 (관리자만)</option>
                        {productions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {[it.createdByName, prodLabel(it)].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {sorted.length > visible && (
            <button onClick={() => setVisible((v) => v + PAGE)} className="btn-ghost mt-3 w-full">
              더 보기 ({sorted.length - visible}개)
            </button>
          )}
        </div>
      ) : (
        /* ===== 리스트 보기 ===== */
        <div className="space-y-1">
          {sorted.slice(0, visible).map((it) => {
            const clips = itemClips(it);
            const multi = clips.length > 1;
            return (
              <div
                key={it.id}
                id={`ar-${it.id}`}
                role={multi ? undefined : "link"}
                tabIndex={multi ? undefined : 0}
                onClick={() => { if (!multi && clips[0]) openLink(clips[0].url); }}
                onKeyDown={(e) => { if (!multi && clips[0] && e.key === "Enter") openLink(clips[0].url); }}
                className={`card !p-3 transition ${multi ? "" : "cursor-pointer hover:ring-1 hover:ring-accent/30"} ${highlightId === it.id ? "ring-2 ring-accent" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className="tf text-2xl">{ARCHIVE_KIND_EMOJI[it.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{it.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                      <span className="text-slate-500">{it.createdByName}</span>
                      <span>·</span>
                      <span>{prodLabel(it)}</span>
                      {it.date && <><span>·</span><span>{it.date}</span></>}
                    </div>
                    {multi && <div className="mt-1.5"><ClipChips clips={clips} /></div>}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setActionItem(it); }}
                    aria-label="더보기"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <DotsVerticalIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {sorted.length > visible && (
            <button onClick={() => setVisible((v) => v + PAGE)} className="btn-ghost mt-1 w-full">
              더 보기 ({sorted.length - visible}개)
            </button>
          )}
        </div>
      )}

      {/* ⋮ 액션시트 */}
      <BottomSheet open={!!actionItem} title={actionItem?.title ?? ""} onClose={() => setActionItem(null)}>
        {actionItem && (() => {
          const clips = itemClips(actionItem);
          return (
            <div className="space-y-0.5">
              {/* 링크 복사 */}
              {clips.length === 1 ? (
                <CopyActionRow url={clips[0].url} label="링크 복사" />
              ) : (
                <button
                  onClick={() => setClipPicker({ mode: "copy", clips, title: actionItem.title })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                >
                  <LinkIcon className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="text-[15px] text-slate-800">링크 복사</span>
                </button>
              )}

              {/* 공유 */}
              {clips.length === 1 ? (
                <button
                  onClick={() => { shareUrl(clips[0].url, actionItem.title); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                >
                  <ShareIcon className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="text-[15px] text-slate-800">공유</span>
                </button>
              ) : (
                <button
                  onClick={() => setClipPicker({ mode: "share", clips, title: actionItem.title })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                >
                  <ShareIcon className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="text-[15px] text-slate-800">공유</span>
                </button>
              )}

              {/* 수정 */}
              {canEdit(actionItem) && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    onClick={() => { setEditItem(actionItem); setActionItem(null); }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                  >
                    <PencilIcon className="h-5 w-5 shrink-0 text-slate-500" />
                    <span className="text-[15px] text-slate-800">수정</span>
                  </button>
                </>
              )}

              {/* 삭제 */}
              {canDelete(actionItem) && (
                <button
                  onClick={() => removeItem(actionItem)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-red-50"
                >
                  <TrashIcon className="h-5 w-5 shrink-0 text-red-400" />
                  <span className="text-[15px] text-red-500">삭제</span>
                </button>
              )}
            </div>
          );
        })()}
      </BottomSheet>

      {/* 영상 선택 서브시트 (링크복사·공유 대상 고르기) */}
      <BottomSheet
        open={!!clipPicker}
        title={clipPicker?.mode === "copy" ? "복사할 영상 선택" : "공유할 영상 선택"}
        onClose={() => setClipPicker(null)}
      >
        {clipPicker && (
          <div className="space-y-0.5">
            {clipPicker.clips.map((c, i) =>
              clipPicker.mode === "copy" ? (
                <CopyActionRow
                  key={i}
                  url={c.url}
                  label={c.label || `영상 ${i + 1}`}
                />
              ) : (
                <button
                  key={i}
                  onClick={() => { shareUrl(c.url, `${clipPicker.title} - ${c.label || `영상 ${i + 1}`}`); setClipPicker(null); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50"
                >
                  <ShareIcon className="h-5 w-5 shrink-0 text-slate-500" />
                  <span className="text-[15px] text-slate-800">{c.label || `영상 ${i + 1}`}</span>
                </button>
              )
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Guard>
      {/* useSearchParams는 Suspense 경계가 필요 */}
      <Suspense fallback={<SkeletonCards />}>
        <ArchiveInner />
      </Suspense>
    </Guard>
  );
}
