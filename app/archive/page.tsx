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
import Guard from "@/components/Guard";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import { ARCHIVE_KIND_LABEL, type ArchiveItem, type ArchiveKind, type Production } from "@/lib/types";
import { chunk, safeExternalUrl } from "@/lib/utils";

function openLink(url: string) {
  const safe = safeExternalUrl(url);
  if (safe) window.open(safe, "_blank", "noreferrer");
  else alert("열 수 없는 링크입니다. (http/https 주소만 지원)");
}

const KIND_STYLE: Record<ArchiveKind, string> = {
  performance: "bg-rose-100 text-rose-600",
  rehearsal: "bg-sky-100 text-sky-600",
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
  const [view, setView] = useState<ViewMode>("card");

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
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">아카이브</h1>
        <button onClick={() => setShowForm((v) => !v)} className="btn-accent">
          {showForm ? "닫기" : "+ 자료 등록"}
        </button>
      </div>

      {showForm && (
        <ArchiveForm
          productions={productions}
          isAdmin={isAdmin}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
          author={{ uid: user?.uid ?? "", name: profile?.name || profile?.displayName || "" }}
        />
      )}

      {/* 검색 / 필터 */}
      <div className="space-y-2">
        <input
          className="input"
          placeholder="제목 · 작품 · 설명 · 태그로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            {([["all", "전체"], ["rehearsal", "연습"], ["performance", "공연"], ["etc", "기타"]] as [ArchiveKind | "all", string][]).map(
              ([k, label]) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 transition ${kindFilter === k ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
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
        <p className="py-12 text-center text-slate-400">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">
          {!isAdmin && productions.length === 0
            ? "참여 중인 작품이 없어 볼 수 있는 자료가 없습니다."
            : "자료가 없습니다."}
        </p>
      ) : view === "card" ? (
        /* ===== 카드 보기 ===== */
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((it) => (
            <div
              key={it.id}
              role="link"
              tabIndex={0}
              onClick={() => openLink(it.url)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openLink(it.url);
              }}
              className="card flex cursor-pointer flex-col !p-4 transition hover:shadow-md hover:ring-1 hover:ring-accent/30"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[it.kind]}`}>
                  {ARCHIVE_KIND_LABEL[it.kind]}
                </span>
                <span className={`chip ${!it.productionId ? "bg-amber-100 text-amber-700" : ""}`}>{prodLabel(it)}</span>
                <span className="text-xs text-slate-400">{it.date}</span>
                <span className="ml-auto text-sm font-semibold text-accent">열기 ↗</span>
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
                  <span className="text-xs text-slate-400">{it.createdByName}</span>
                )}
                {canDelete(it) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(it);
                    }}
                    className="shrink-0 text-xs text-red-500 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ===== 리스트 보기 ===== */
        <div className="card divide-y divide-slate-100 !p-0">
          {filtered.map((it) => (
            <div
              key={it.id}
              role="link"
              tabIndex={0}
              onClick={() => openLink(it.url)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openLink(it.url);
              }}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
            >
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[it.kind]}`}>
                {ARCHIVE_KIND_LABEL[it.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.title}</p>
                <p className="truncate text-xs text-slate-400">
                  {[prodLabel(it), it.date, it.createdByName].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-accent">열기 ↗</span>
              {canDelete(it) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeItem(it);
                  }}
                  className="shrink-0 text-xs text-red-500 hover:underline"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveForm({
  productions,
  isAdmin,
  onSaved,
  author,
}: {
  productions: Production[];
  isAdmin: boolean;
  onSaved: () => void;
  author: { uid: string; name: string };
}) {
  const [title, setTitle] = useState("");
  const [productionId, setProductionId] = useState("");
  const [kind, setKind] = useState<ArchiveKind>("performance");
  const [date, setDate] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || !url.trim()) {
      alert("제목과 링크는 필수입니다.");
      return;
    }
    if (!isAdmin && !productionId) {
      alert("작품을 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const item: Omit<ArchiveItem, "id"> = {
        title: title.trim(),
        productionId: productionId || null,
        kind,
        date: date || new Date().toISOString().slice(0, 10),
        url: url.startsWith("http") ? url : `https://${url}`,
        description,
        tags: tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
        createdBy: author.uid,
        createdByName: author.name,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, "archives", id), item);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">작품</label>
          <select className="input" value={productionId} onChange={(e) => setProductionId(e.target.value)}>
            <option value="">{isAdmin ? "미지정 (관리자만 볼 수 있음)" : "작품을 선택하세요"}</option>
            {productions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {productions.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              {isAdmin ? "작품 관리에서 작품을 먼저 만들어 주세요." : "참여 중인 작품이 없습니다."}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="label">제목 (예: 커튼콜, 1막 런스루)</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
        </div>
        <div>
          <label className="label">종류</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ArchiveKind)}>
            <option value="performance">공연</option>
            <option value="rehearsal">연습</option>
            <option value="etc">기타</option>
          </select>
        </div>
        <div>
          <label className="label">날짜</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">링크 (유튜브·구글포토 등 사진/영상 주소)</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/..." />
        </div>
        <div className="sm:col-span-2">
          <label className="label">설명·메모</label>
          <textarea className="input min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">태그 (쉼표 또는 띄어쓰기로 구분)</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="커튼콜 메이킹 1막" />
        </div>
      </div>
      <button onClick={save} disabled={busy} className="btn-accent w-full">
        {busy ? "등록 중…" : "자료 등록"}
      </button>
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
