"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import { BoardIcon, EyeIcon, HeartIcon, PencilIcon } from "@/components/Icons";
import { usePostEditor } from "@/lib/post-editor-context";
import { SkeletonList } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import Select from "@/components/Select";
import { ProfileName } from "@/components/ProfileViewer";
import { relativeTime } from "@/lib/utils";
import { boardCategoryLabel, DEFAULT_BOARD_CATEGORIES, type Post } from "@/lib/types";

const DAY = 86_400_000;
const isRecent = (p: Post) => (p.createdAt ?? 0) > Date.now() - 7 * DAY;

function BoardInner() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { settings, saveSettings } = useTheme();
  const categories =
    settings.boardCategories && settings.boardCategories.length > 0
      ? settings.boardCategories
      : DEFAULT_BOARD_CATEGORIES;

  const { openWrite } = usePostEditor();
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

  // 글은 최신순으로 필요한 만큼만 끊어서 불러온다.
  // (예전엔 컬렉션 전체를 본문 HTML까지 통째로 읽어서, 글이 쌓일수록 계속 무거워졌음)
  // 카테고리는 동적이라 where 대신 화면에서 거르고, 부족하면 아래 효과가 더 불러온다.
  // → orderBy 하나만 쓰므로 복합 색인을 따로 만들 필요가 없다.
  const FETCH = 150;
  const cursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const fetching = useRef(false);
  const [hasMore, setHasMore] = useState(false);

  const loadBoard = useCallback(async (first = false) => {
    if (fetching.current) return;
    fetching.current = true;
    if (first) setLoading(true);
    try {
      const after = first ? null : cursor.current;
      const snap = await getDocs(
        after
          ? query(collection(db, "posts"), orderBy("createdAt", "desc"), startAfter(after), limit(FETCH))
          : query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(FETCH))
      );
      cursor.current = snap.docs[snap.docs.length - 1] ?? cursor.current;
      setHasMore(snap.docs.length === FETCH); // 꽉 채워 왔으면 더 있을 수 있음
      // 공지는 위쪽 고정 영역에서 따로 보여주므로 목록에서는 제외
      const batch = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
        .filter((p) => !p.isNotice);
      setPosts((prev) => (first ? batch : [...prev, ...batch]));
    } finally {
      fetching.current = false;
      if (first) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotices();
    loadBoard(true);
  }, [loadNotices, loadBoard]);

  // 글 목록 순서를 저장 → 상세의 이전/다음글이 게시판 전체를 다시 읽지 않도록 공유
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "board-order",
        JSON.stringify(posts.map((p) => ({ id: p.id, title: p.title, board: p.board })))
      );
    } catch {
      /* 무시 */
    }
  }, [posts]);

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
    // 목록을 끊어서 불러오므로 아직 안 읽은 글이 있을 수 있음 → 그럴 땐 '이상'으로 표기
    const cnt = countByCat(c);
    const cntText = hasMore ? `${cnt}개 이상` : `${cnt}개`;
    const msg =
      cnt > 0
        ? `'${c}' 종류에 글 ${cntText}가 있어요. 탭을 지우면 그 글들은 '전체'에서만 보이게 됩니다(삭제는 아님). 계속할까요?`
        : `'${c}' 종류를 삭제할까요?`;
    if (!confirm(msg)) return;
    await saveSettings({ boardCategories: categories.filter((x) => x !== c) });
    if (tab === c) setTab("all");
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const curPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((curPage - 1) * PAGE, curPage * PAGE);

  // 지금 보는 탭·검색 조건으로 걸러낸 글이 현재 페이지를 채우기에 모자라면 다음 묶음을 더 받는다.
  // 드물게 쓰는 카테고리를 골라도 예전(전체 로드)과 같은 결과가 나오되, 필요한 만큼만 읽는다.
  useEffect(() => {
    if (loading || !hasMore) return;
    if (filtered.length < curPage * PAGE + PAGE) loadBoard();
  }, [filtered.length, curPage, hasMore, loading, loadBoard]);

  function runSearch() {
    setSearchQuery(searchInput);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">게시판</h1>
        <button
          onClick={() => openWrite(tab !== "all" ? tab : undefined)}
          aria-label="글쓰기"
          title="글쓰기"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
        >
          <PencilIcon className="h-5 w-5" />
        </button>
      </div>

      {/* 탭 → 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {["all", ...categories].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition ${
                tab === t ? "bg-slate-800 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
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
              {isRecent(p) && (
                <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none text-accent-fg">NEW</span>
              )}
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
        <div className="space-y-2">
          {pageItems.map((p) => (
            <Link key={p.id} href={`/board/${p.id}`} className="card block !px-4 !py-3 transition hover:ring-1 hover:ring-accent/30">
              {/* 제목 행 */}
              <p className="flex items-center gap-1.5 font-medium text-slate-900">
                <span className="truncate">{p.title}</span>
                {isRecent(p) && (
                  <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-extrabold leading-none text-accent-fg">NEW</span>
                )}
                {p.poll && <span className="shrink-0 text-xs text-slate-400">🗳️</span>}
                {(p.hasImages || (p.images?.length ?? 0) > 0) && <span className="shrink-0 text-xs text-slate-400">📷</span>}
                {(p.commentCount ?? 0) > 0 && (
                  <span className="shrink-0 text-sm font-bold text-accent">[{p.commentCount}]</span>
                )}
              </p>
              {/* 메타 행: 작성자 | 날짜 | 조회수 | 좋아요 */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                <span className="text-slate-500 font-medium"><ProfileName uid={p.authorUid} name={p.authorName} /></span>
                <span>|</span>
                <span>{relativeTime(p.createdAt)}</span>
                <span>|</span>
                <span className="inline-flex items-center gap-0.5">
                  <EyeIcon className="h-3.5 w-3.5" />
                  조회수 {p.viewCount ?? 0}
                </span>
                {(p.likeCount ?? 0) > 0 && (
                  <>
                    <span>|</span>
                    <span className="inline-flex items-center gap-0.5 text-rose-400">
                      <HeartIcon className="h-3.5 w-3.5" />
                      {p.likeCount}
                    </span>
                  </>
                )}
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
          <button onClick={runSearch} className="shrink-0 rounded-xl bg-[#1a2744] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#243258]">
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
