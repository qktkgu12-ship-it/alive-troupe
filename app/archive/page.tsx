"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import { ARCHIVE_KIND_LABEL, type ArchiveItem, type ArchiveKind } from "@/lib/types";

const KIND_STYLE: Record<ArchiveKind, string> = {
  performance: "bg-rose-100 text-rose-600",
  rehearsal: "bg-sky-100 text-sky-600",
  etc: "bg-slate-100 text-slate-600",
};

function ArchiveInner() {
  const { user, profile, role } = useAuth();
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ArchiveKind | "all">("all");
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = query(collection(db, "archives"), orderBy("date", "desc"));
      const snap = await getDocs(q);
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (!s) return true;
      return (
        it.title.toLowerCase().includes(s) ||
        it.description.toLowerCase().includes(s) ||
        (it.tags ?? []).some((t) => t.toLowerCase().includes(s))
      );
    });
  }, [items, search, kindFilter]);

  async function removeItem(it: ArchiveItem) {
    if (!confirm("이 자료를 삭제할까요?")) return;
    await deleteDoc(doc(db, "archives", it.id));
    load();
  }

  const canDelete = (it: ArchiveItem) => role === "admin" || it.createdBy === user?.uid;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">아카이빙</h1>
        <button onClick={() => setShowForm((v) => !v)} className="btn-accent">
          {showForm ? "닫기" : "+ 자료 등록"}
        </button>
      </div>

      {showForm && (
        <ArchiveForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
          author={{ uid: user?.uid ?? "", name: profile?.name || profile?.displayName || "" }}
        />
      )}

      {/* 검색 / 필터 */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input"
          placeholder="제목 · 설명 · 태그로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {([["all", "전체"], ["performance", "공연"], ["rehearsal", "연습"], ["etc", "기타"]] as [ArchiveKind | "all", string][]).map(
            ([k, label]) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`rounded-lg px-3 py-1.5 transition ${kindFilter === k ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-slate-400">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">자료가 없습니다.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((it) => (
            <div key={it.id} className="card flex flex-col !p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[it.kind]}`}>
                  {ARCHIVE_KIND_LABEL[it.kind]}
                </span>
                <span className="text-xs text-slate-400">{it.date}</span>
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
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <a href={it.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent hover:underline">
                  자료 열기 ↗
                </a>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{it.createdByName}</span>
                  {canDelete(it) && (
                    <button onClick={() => removeItem(it)} className="text-xs text-red-500 hover:underline">삭제</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveForm({
  onSaved,
  author,
}: {
  onSaved: () => void;
  author: { uid: string; name: string };
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ArchiveKind>("performance");
  const [date, setDate] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title || !url) {
      alert("공연·연습명과 링크는 필수입니다.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const item: Omit<ArchiveItem, "id"> = {
        title,
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
          <label className="label">공연·연습명</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2026 정기공연 커튼콜" />
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
