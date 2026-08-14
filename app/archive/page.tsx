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
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import { SkeletonCards } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import Select from "@/components/Select";
import BottomSheet from "@/components/BottomSheet";
import ArchiveForm, { itemClips } from "@/components/forms/ArchiveForm";
import { useCreateSheet } from "@/lib/create-sheet-context";
import { ArchiveIcon, CalendarIcon, CheckIcon, LinkIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "@/components/Icons";
import { ARCHIVE_KIND_LABEL, type ArchiveClip, type ArchiveItem, type ArchiveKind, type Production } from "@/lib/types";
import { chunk, safeExternalUrl } from "@/lib/utils";

function openLink(url: string) {
  const safe = safeExternalUrl(url);
  if (safe) window.open(safe, "_blank", "noreferrer");
  else alert("열 수 없는 링크입니다. (http/https 주소만 지원)");
}

// (todayStr·itemClips 는 ArchiveForm 으로 이동 — itemClips 는 거기서 import)

// 링크 복사 버튼 (복사 후 2초 체크 표시)
function CopyBtn({ url, onClick }: { url: string; onClick?: (e: React.MouseEvent) => void }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    onClick?.(e);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      aria-label="링크 복사"
      className={`grid h-8 w-8 place-items-center rounded-lg transition ${
        copied ? "text-green-500" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {copied ? <CheckIcon className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
    </button>
  );
}

// 영상 칩들 (라벨이 비면 '영상 N') — ▶ 재생 아이콘으로 '눌러서 보기' 표시
function ClipChips({ clips }: { clips: ArchiveClip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {clips.map((c, i) => (
        <div key={i} className="inline-flex items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openLink(c.url);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-95"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M3 2l7 4-7 4z" />
            </svg>
            {c.label || `영상 ${i + 1}`}
          </button>
          <CopyBtn url={c.url} />
        </div>
      ))}
    </div>
  );
}

const KIND_STYLE: Record<ArchiveKind, string> = {
  performance: "bg-slate-100 text-slate-600",
  rehearsal: "bg-slate-100 text-slate-600",
  etc: "bg-slate-100 text-slate-600",
};

function ArchiveInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";

  const [productions, setProductions] = useState<Production[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ArchiveKind | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<ArchiveItem | null>(null);
  // 헤더 '+' 등록 메뉴에서 들어오면(?new=1) 등록 폼을 바로 열기
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setShowForm(true);
  }, []);
  const [view, setViewState] = useState<ViewMode>("card");
  // 카드/리스트 선택을 계정별로 기억 (기기 내 localStorage, uid별)
  useEffect(() => {
    if (!user) return;
    try {
      const v = localStorage.getItem(`archive-view-${user.uid}`);
      if (v === "card" || v === "list") setViewState(v);
    } catch {
      /* 무시 */
    }
  }, [user]);
  function setView(v: ViewMode) {
    setViewState(v);
    try {
      if (user) localStorage.setItem(`archive-view-${user.uid}`, v);
    } catch {
      /* 무시 */
    }
  }
  const sortOrder = "newest";
  const PAGE = 30;
  const [visible, setVisible] = useState(PAGE);

  const prodMap = useMemo(() => new Map(productions.map((p) => [p.id, p])), [productions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 접근 가능한 작품 (관리자 전체 / 정단원은 참여 작품만)
      const pq = isAdmin
        ? query(collection(db, "productions"), orderBy("order", "asc"))
        : query(collection(db, "productions"), where("participants", "array-contains", user?.uid ?? "__none__"));
      const psnap = await getDocs(pq);
      const prods = psnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }));
      setProductions(prods);

      // 아카이빙 자료
      let list: ArchiveItem[] = [];
      if (isAdmin) {
        const snap = await getDocs(query(collection(db, "archives"), orderBy("date", "desc")));
        list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) }));
      } else {
        const ids = prods.map((p) => p.id);
        if (ids.length > 0) {
          for (const part of chunk(ids, 30)) {
            const snap = await getDocs(query(collection(db, "archives"), where("productionId", "in", part)));
            list.push(...snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) })));
          }
          list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        }
      }
      setItems(list);
    } catch (e) {
      console.error("아카이브 불러오기 오류:", e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

  // 헤더 '+' 바텀시트로 자료를 등록하면 목록 새로고침
  const { createdAt } = useCreateSheet();
  useEffect(() => {
    if (createdAt?.kind === "archive") load();
  }, [createdAt, load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (!s) return true;
      const prodName = it.productionId ? prodMap.get(it.productionId)?.name ?? "" : "";
      return (
        it.title.toLowerCase().includes(s) ||
        it.description.toLowerCase().includes(s) ||
        prodName.toLowerCase().includes(s) ||
        (it.tags ?? []).some((t) => t.toLowerCase().includes(s))
      );
    });
  }, [items, search, kindFilter, prodMap]);

  // 날짜순(최신/오래된) 정렬 + 같은 날짜는 제목 가나다순
  const sorted = useMemo(() => {
    const dir = sortOrder === "newest" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const byDate = (a.date || "").localeCompare(b.date || "") * dir;
      if (byDate !== 0) return byDate;
      return (a.title || "").localeCompare(b.title || "", "ko");
    });
  }, [filtered, sortOrder]);

  useEffect(() => {
    setVisible(PAGE);
  }, [search, kindFilter, sortOrder]);

  async function removeItem(it: ArchiveItem) {
    if (!confirm("이 자료를 삭제할까요?")) return;
    await deleteDoc(doc(db, "archives", it.id));
    load();
  }

  async function changeProduction(it: ArchiveItem, pid: string) {
    await setDoc(doc(db, "archives", it.id), { productionId: pid || null }, { merge: true });
    load();
  }

  const canDelete = (it: ArchiveItem) => isAdmin || it.createdBy === user?.uid;
  const prodLabel = (it: ArchiveItem) => (it.productionId ? prodMap.get(it.productionId)?.name ?? "삭제된 작품" : "미지정");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">아카이브</h1>
        <button
          onClick={() => {
            if (showForm || editItem) {
              setShowForm(false);
              setEditItem(null);
            } else {
              setShowForm(true);
            }
          }}
          aria-label={showForm || editItem ? "닫기" : "자료 등록"}
          title={showForm || editItem ? "닫기" : "자료 등록"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
        >
          {showForm || editItem ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
        </button>
      </div>

      {/* 등록·수정은 바텀시트로 */}
      <BottomSheet
        open={showForm || !!editItem}
        title={editItem ? "자료 수정" : "자료 등록"}
        onClose={() => {
          setShowForm(false);
          setEditItem(null);
        }}
      >
        <ArchiveForm
          key={editItem?.id ?? "new"}
          edit={editItem ?? undefined}
          productions={productions}
          isAdmin={isAdmin}
          onSaved={() => {
            setShowForm(false);
            setEditItem(null);
            load();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditItem(null);
          }}
          author={{ uid: user?.uid ?? "", name: profile?.name || profile?.displayName || "" }}
        />
      </BottomSheet>

      {/* 검색 / 필터 */}
      <div className="space-y-2">
        <input
          className="input"
          placeholder="제목 · 작품 · 설명 · 태그로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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

      {loading ? (
        <SkeletonCards />
      ) : sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ArchiveIcon}
            title="자료가 없습니다."
            hint={!isAdmin && productions.length === 0 ? "참여 중인 작품이 없어요." : undefined}
          />
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
              role={multi ? undefined : "link"}
              tabIndex={multi ? undefined : 0}
              onClick={() => {
                if (!multi && clips[0]) openLink(clips[0].url);
              }}
              onKeyDown={(e) => {
                if (!multi && clips[0] && e.key === "Enter") openLink(clips[0].url);
              }}
              className={`card flex flex-col !p-4 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)] ${multi ? "" : "cursor-pointer hover:ring-1 hover:ring-accent/30"}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[it.kind]}`}>
                  {ARCHIVE_KIND_LABEL[it.kind]}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {it.date}
                </span>
                {multi && (
                  <span className="ml-auto text-xs font-semibold text-slate-400">영상 {clips.length}개</span>
                )}
              </div>
              <h3 className="font-semibold">{it.title}</h3>
              {it.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{it.description}</p>}
              {(it.tags ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.tags.map((t) => (
                    <span key={t} className="chip">#{t}</span>
                  ))}
                </div>
              )}
              {multi && (
                <div className="mt-3">
                  <ClipChips clips={clips} />
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                {isAdmin ? (
                  <select
                    value={it.productionId ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => changeProduction(it, e.target.value)}
                    className="max-w-[60%] rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
                  >
                    <option value="">미지정 (관리자만)</option>
                    {productions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-400">
                    {[it.createdByName, prodLabel(it)].filter(Boolean).join(" · ")}
                  </span>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  {!multi && clips[0] && <CopyBtn url={clips[0].url} />}
                  {canDelete(it) && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowForm(false);
                          setEditItem(it);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        aria-label="수정"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeItem(it);
                        }}
                        aria-label="삭제"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
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
        <div className="space-y-2">
          {sorted.slice(0, visible).map((it) => {
            const clips = itemClips(it);
            const multi = clips.length > 1;
            return (
            <div
              key={it.id}
              role={multi ? undefined : "link"}
              tabIndex={multi ? undefined : 0}
              onClick={() => {
                if (!multi && clips[0]) openLink(clips[0].url);
              }}
              onKeyDown={(e) => {
                if (!multi && clips[0] && e.key === "Enter") openLink(clips[0].url);
              }}
              className={`card !p-3 transition ${multi ? "" : "cursor-pointer hover:ring-1 hover:ring-accent/30"}`}
            >
              <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{it.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                  <span className="chip !bg-slate-100 !px-1.5 !py-0">{ARCHIVE_KIND_LABEL[it.kind]}</span>
                  <span className="text-slate-500">{it.createdByName}</span>
                  {prodLabel(it) && <><span>·</span><span>{prodLabel(it)}</span></>}
                  {it.date && <><span>·</span><span>{it.date}</span></>}
                </div>
                {multi && (
                  <div className="mt-1.5">
                    <ClipChips clips={clips} />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!multi && clips[0] && <CopyBtn url={clips[0].url} />}
                {canDelete(it) && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowForm(false);
                        setEditItem(it);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      aria-label="수정"
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(it);
                      }}
                      aria-label="삭제"
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
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
    </div>
  );
}


export default function ArchivePage() {
  return (
    <Guard>
      <ArchiveInner />
    </Guard>
  );
}
