"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Guard from "@/components/Guard";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/lib/auth-context";
import { searchAll, SEARCH_KIND_LABEL, SEARCH_KIND_ORDER, type SearchKind, type SearchResult } from "@/lib/search";
import { ArchiveIcon, BoardIcon, CalendarIcon, FolderIcon, SearchIcon } from "@/components/Icons";

const KIND_ICON: Record<SearchKind, React.FC<{ className?: string }>> = {
  board: BoardIcon,
  archive: ArchiveIcon,
  audio: FolderIcon,
  event: CalendarIcon,
};

type Chip = "all" | SearchKind;

function SearchInner() {
  const { user, role } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";

  const [input, setInput] = useState(q);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [chip, setChip] = useState<Chip>("all");

  useEffect(() => {
    setInput(q);
  }, [q]);

  const run = useCallback(async () => {
    if (!q.trim() || !user) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      setResults(await searchAll(q, { uid: user.uid, isAdmin: role === "admin" }));
    } finally {
      setLoading(false);
    }
  }, [q, user, role]);

  useEffect(() => {
    run();
  }, [run]);

  // 종류별 개수 (칩에 표시)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: results.length };
    for (const r of results) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [results]);

  const visible = chip === "all" ? results : results.filter((r) => r.kind === chip);

  // '전체'일 때는 종류별로 묶어서 보여줌
  const grouped: [SearchKind, SearchResult[]][] = useMemo(() => {
    if (chip !== "all") return [];
    return SEARCH_KIND_ORDER.map((k) => [k, results.filter((r) => r.kind === k)] as [SearchKind, SearchResult[]]).filter(
      ([, list]) => list.length > 0
    );
  }, [chip, results]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (t) router.replace(`/search?q=${encodeURIComponent(t)}`);
  }

  return (
    <div className="space-y-5">
      {/* 검색창 */}
      <form onSubmit={submit} className="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5">
        <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" />
        <input
          autoFocus={!q}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ALIVE 전체 검색"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
        />
        {input && (
          <button type="button" onClick={() => setInput("")} aria-label="지우기" className="shrink-0 text-slate-400 transition hover:text-slate-600">
            ✕
          </button>
        )}
      </form>

      {!q.trim() ? (
        <div className="card">
          <EmptyState icon={SearchIcon} title="무엇을 찾으시나요?" hint="게시판·아카이브·자료실·일정을 한 번에 검색해요." />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              &apos;{q}&apos; 검색 결과
            </h1>
            <span className="text-sm font-semibold text-slate-400">{loading ? "…" : `${results.length}건`}</span>
          </div>

          {/* 종류 칩 */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {([["all", "전체"], ...SEARCH_KIND_ORDER.map((k) => [k, SEARCH_KIND_LABEL[k]] as [Chip, string])] as [Chip, string][]).map(
              ([val, label]) => {
                const n = counts[val] ?? 0;
                const on = chip === val;
                return (
                  <button
                    key={val}
                    onClick={() => setChip(val)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                      on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                    {n > 0 && <span className={`ml-1 ${on ? "opacity-70" : "text-slate-400"}`}>{n}</span>}
                  </button>
                );
              }
            )}
          </div>

          {loading ? (
            <div className="card text-center text-sm text-slate-400">검색 중…</div>
          ) : results.length === 0 ? (
            <div className="card">
              <EmptyState icon={SearchIcon} title="검색 결과가 없어요." hint="다른 검색어로 찾아보세요." />
            </div>
          ) : chip === "all" ? (
            <div className="space-y-5">
              {grouped.map(([kind, list]) => (
                <section key={kind}>
                  <div className="mb-2 flex items-baseline gap-1.5">
                    <h2 className="font-bold text-slate-900">{SEARCH_KIND_LABEL[kind]}</h2>
                    <span className="text-sm text-slate-400">({list.length})</span>
                    {list.length > 3 && (
                      <button onClick={() => setChip(kind)} className="ml-auto text-xs font-semibold text-accent">
                        더보기 ›
                      </button>
                    )}
                  </div>
                  <ResultList items={list.slice(0, 3)} />
                </section>
              ))}
            </div>
          ) : (
            <ResultList items={visible} />
          )}
        </>
      )}
    </div>
  );
}

function ResultList({ items }: { items: SearchResult[] }) {
  return (
    <div className="space-y-2">
      {items.map((r) => {
        const Icon = KIND_ICON[r.kind];
        return (
          <Link
            key={`${r.kind}-${r.id}`}
            href={r.href}
            className="card flex items-start gap-3 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900">{r.title}</span>
              {r.sub && <span className="mt-0.5 block truncate text-sm text-slate-500">{r.sub}</span>}
              {r.meta && <span className="mt-0.5 block truncate text-xs text-slate-400">{r.meta}</span>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Guard>
      <Suspense fallback={<div className="card flex justify-center py-6"><Spinner /></div>}>
        <SearchInner />
      </Suspense>
    </Guard>
  );
}
