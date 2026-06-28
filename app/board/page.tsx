"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import { BoardIcon, CommentIcon, EyeIcon, HeartIcon, PencilIcon } from "@/components/Icons";
import { SkeletonList } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import Select from "@/components/Select";
import { relativeTime } from "@/lib/utils";
import { boardCategoryLabel, DEFAULT_BOARD_CATEGORIES, type Post } from "@/lib/types";

function BoardInner() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { settings, saveSettings } = useTheme();
  const categories =
    settings.boardCategories && settings.boardCategories.length > 0
      ? settings.boardCategories
      : DEFAULT_BOARD_CATEGORIES;

  const [tab, setTab] = useState<string>("all"); // "all" 또는 카테고리 이름
  const [posts, setPosts] = useState<Post[]>([]);
  const [notices, setNotices] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [manageCats, setManageCats] = useState(false);
  const [newCat, setNewCat] = useState("");

  const PAGE = 20;
  const [page, setPage] = useState(1);

  // 검색
  type SearchField = "title" | "titleContent" | "author";
  const [searchField, setSearchField] = useState<SearchField>("title");
  const [searchInput, setSearchInput] = useState(""); // 입력 중인 값
  const [searchQuery, setSearchQuery] = useState(""); // 적용된 검색어

  const loadNotices = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "posts"), where("isNotice", "==", true)));
    setNotices(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
        .sort((a, b) => b.createdAt - a.createdAt)
    );
  }, []);

  // 글은 한 번에 모두 불러오고, 탭/검색은 화면에서 거름 (카테고리가 동적이라 단순·안전)
  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "posts"));
      setPosts(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
          .filter((p) => !p.isNotice)
          .sort((a, b) => b.createdAt - a.createdAt)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotices();
    loadBoard();
  }, [loadNotices, loadBoard]);

  // 글 상세의 '목록' 버튼 등에서 ?cat=무대 로 들어오면 해당 탭으로 시작
  useEffect(() => {
    const cat = new URLSearchParams(window.location.search).get("cat");
    if (cat) setTab(cat);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  // 탭(카테고리) + 검색어로 거른 목록
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((p) => {
      if (tab !== "all" && boardCategoryLabel(p.board) !== tab) return false;
      if (!q) return true;
      if (searchField === "title") return p.title.toLowerCase().includes(q);
      if (searchField === "author") return (p.authorName || "").toLowerCase().includes(q);
      return p.title.toLowerCase().includes(q) || (p.content || "").toLowerCase().includes(q);
    });
  }, [posts, tab, searchQuery, searchField]);

  const countByCat = (c: string) => posts.filter((p) => boardCategoryLabel(p.board) === c).length;

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    if (categories.includes(name)) {
      alert("이미 있는 종류예요.");
      return;
    }
    await saveSettings({ boardCategories: [...categories, name] });
    setNewCat("");
    setTab(name);
  }
  async function removeCategory(c: string) {
    const cnt = countByCat(c);
    const msg =
      cnt > 0
        ? `'${c}' 종류에 글 ${cnt}개가 있어요. 탭을 지우면 그 글들은 '전체'에서만 보이게 됩니다(삭제는 아님). 계속할까요?`
        : `'${c}' 종류를 삭제할까요?`;
    if (!confirm(msg)) return;
    await saveSettings({ boardCategories: categories.filter((x) => x !== c) });
    if (tab === c) setTab("all");
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const curPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((curPage - 1) * PAGE, curPage * PAGE);

  function runSearch() {
    setSearchQuery(searchInput);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">게시판</h1>
        <Link
          href="/board/write"
          aria-label="글쓰기"
          title="글쓰기"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
        >
          <PencilIcon className="h-5 w-5" />
        </Link>
      </div>

      {/* 탭 (카테고리가 늘어나면 가로로 스크롤) */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 overflow-x-auto rounded-xl bg-surface p-1 text-sm font-medium">
          {["all", ...categories].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2 transition ${
                tab === t ? "bg-white text-accent shadow-sm" : "text-slate-500"
              }`}
            >
              {t === "all" ? "전체" : t}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button onClick={() => setManageCats((v) => !v)} className="shrink-0 text-xs font-medium text-slate-500 hover:underline">
            {manageCats ? "완료" : "종류 편집"}
          </button>
        )}
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

      {/* 공지 (모든 게시판 상단 고정) */}
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((p) => (
            <Link
              key={p.id}
              href={`/board/${p.id}`}
              className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3 transition hover:brightness-[0.98]"
            >
              <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">공지</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{p.title}</span>
              <span className="shrink-0 text-xs text-slate-400">{relativeTime(p.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* 게시글 목록 */}
      {loading ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={BoardIcon}
            title={searchQuery ? "검색 결과가 없습니다." : "아직 글이 없습니다."}
            hint={searchQuery ? undefined : "첫 글을 남겨보세요!"}
          />
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 !p-0">
          {pageItems.map((p) => (
            <Link key={p.id} href={`/board/${p.id}`} className="block px-4 py-3 transition hover:bg-slate-50">
              <p className="flex items-center gap-1.5 truncate font-medium text-slate-900">
                <span className="truncate">{p.title}</span>
                {(p.hasImages || (p.images?.length ?? 0) > 0) && <span className="shrink-0 text-xs text-slate-400">📷</span>}
                {(p.commentCount ?? 0) > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent">
                    <CommentIcon className="h-3.5 w-3.5" />
                    {p.commentCount}
                  </span>
                )}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                {(p.likeCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-slate-500">
                    <HeartIcon className="h-3.5 w-3.5" />
                    {p.likeCount}
                  </span>
                )}
                <span className="chip !bg-slate-100 !px-1.5 !py-0">{boardCategoryLabel(p.board)}</span>
                <span className="text-slate-500">{p.authorName}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <EyeIcon className="h-3.5 w-3.5" />
                  {p.viewCount ?? 0}
                </span>
                <span>·</span>
                <span>{relativeTime(p.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 페이지 번호 */}
      {!loading && pageCount > 1 && (
        <Pagination
          page={curPage}
          pageCount={pageCount}
          onChange={(p) => {
            setPage(p);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      {/* 검색 (중앙 정렬, 좌우 여백) */}
      {!loading && (
        <div className="mx-auto flex w-full max-w-[480px] gap-2">
          <Select
            wrapperClassName="w-28 shrink-0"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as SearchField)}
          >
            <option value="title">제목</option>
            <option value="titleContent">제목+내용</option>
            <option value="author">글쓴이</option>
          </Select>
          <input
            className="input flex-1"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="검색할 단어 입력"
          />
          <button onClick={runSearch} className="btn-accent shrink-0">
            검색
          </button>
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  const WINDOW = 5;
  let start = Math.max(1, page - Math.floor(WINDOW / 2));
  const end = Math.min(pageCount, start + WINDOW - 1);
  start = Math.max(1, end - WINDOW + 1);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  const base = "grid h-9 min-w-[36px] place-items-center rounded-lg px-3 text-sm font-medium transition";
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={`${base} border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40`}
      >
        이전
      </button>
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`${base} ${
            n === page ? "bg-accent text-accent-fg" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {n}
        </button>
      ))}
      <button
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        className={`${base} border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40`}
      >
        다음
      </button>
    </div>
  );
}

export default function BoardPage() {
  return (
    <Guard>
      <BoardInner />
    </Guard>
  );
}
