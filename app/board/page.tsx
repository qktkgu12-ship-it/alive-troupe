"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import { BOARD_LABEL, BOARD_ORDER, type BoardKey, type Post } from "@/lib/types";

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function BoardInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";

  const [board, setBoard] = useState<BoardKey>("free");
  const [posts, setPosts] = useState<Post[]>([]);
  const [notices, setNotices] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadNotices = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "posts"), where("isNotice", "==", true)));
    setNotices(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
        .sort((a, b) => b.createdAt - a.createdAt)
    );
  }, []);

  const loadBoard = useCallback(async (b: BoardKey) => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "posts"), where("board", "==", b)));
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
  }, [loadNotices]);

  useEffect(() => {
    loadBoard(board);
  }, [board, loadBoard]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">게시판</h1>
        <button onClick={() => setShowForm((v) => !v)} className="btn-accent">
          {showForm ? "닫기" : "글쓰기"}
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {BOARD_ORDER.map((b) => (
          <button
            key={b}
            onClick={() => setBoard(b)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 transition ${
              board === b ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {BOARD_LABEL[b]}
          </button>
        ))}
      </div>

      {showForm && (
        <PostForm
          board={board}
          isAdmin={isAdmin}
          author={{ uid: user?.uid ?? "", name: profile?.name || profile?.displayName || "" }}
          onSaved={() => {
            setShowForm(false);
            loadNotices();
            loadBoard(board);
          }}
        />
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
              <span className="shrink-0 text-xs text-slate-400">{fmtDate(p.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* 게시글 목록 */}
      {loading ? (
        <p className="py-12 text-center text-slate-400">불러오는 중…</p>
      ) : posts.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">아직 글이 없습니다. 첫 글을 남겨보세요!</p>
      ) : (
        <div className="card divide-y divide-slate-100 !p-0">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/board/${p.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{p.title}</p>
                <p className="truncate text-xs text-slate-400">{p.authorName}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{fmtDate(p.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function PostForm({
  board,
  isAdmin,
  author,
  onSaved,
}: {
  board: BoardKey;
  isAdmin: boolean;
  author: { uid: string; name: string };
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [asNotice, setAsNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || !content.trim()) {
      alert("제목과 내용을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const now = Date.now();
      const post: Omit<Post, "id"> = {
        board,
        isNotice: isAdmin ? asNotice : false,
        title: title.trim(),
        content: content.trim(),
        authorUid: author.uid,
        authorName: author.name,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "posts", id), post);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <label className="label">제목</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${BOARD_LABEL[board]}에 글쓰기`} />
      </div>
      <div>
        <label className="label">내용</label>
        <textarea className="input min-h-[140px]" value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      {isAdmin && (
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={asNotice} onChange={(e) => setAsNotice(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          📢 공지로 등록 (모든 게시판 상단에 고정)
        </label>
      )}
      <button onClick={save} disabled={busy} className="btn-accent w-full">
        {busy ? "등록 중…" : "등록"}
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
