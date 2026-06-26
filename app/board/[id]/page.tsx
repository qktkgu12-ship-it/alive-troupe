"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import { BOARD_LABEL, type Post } from "@/lib/types";

function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function PostDetailInner() {
  const { id } = useParams<{ id: string }>();
  const { user, role } = useAuth();
  const router = useRouter();
  const isAdmin = role === "admin";

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [asNotice, setAsNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "posts", id))
      .then((snap) => {
        if (snap.exists()) {
          const p = { id: snap.id, ...(snap.data() as Omit<Post, "id">) };
          setPost(p);
          setTitle(p.title);
          setContent(p.content);
          setAsNotice(p.isNotice);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const canEdit = post && (isAdmin || post.authorUid === user?.uid);

  async function save() {
    if (!post || !title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      await setDoc(
        doc(db, "posts", post.id),
        {
          title: title.trim(),
          content: content.trim(),
          isNotice: isAdmin ? asNotice : post.isNotice,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      setPost({ ...post, title: title.trim(), content: content.trim(), isNotice: isAdmin ? asNotice : post.isNotice });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!post || !confirm("이 글을 삭제할까요?")) return;
    await deleteDoc(doc(db, "posts", post.id));
    router.replace("/board");
  }

  if (loading) return <p className="py-12 text-center text-slate-400">불러오는 중…</p>;
  if (!post)
    return (
      <div className="card text-center">
        <p className="text-slate-500">글을 찾을 수 없습니다.</p>
        <Link href="/board" className="mt-3 inline-block text-sm font-medium text-accent">← 게시판으로</Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <Link href="/board" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900">
        ← 게시판
      </Link>

      {editing ? (
        <div className="card space-y-3">
          <div>
            <label className="label">제목</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">내용</label>
            <textarea className="input min-h-[160px]" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={asNotice} onChange={(e) => setAsNotice(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
              📢 공지로 등록
            </label>
          )}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="btn-accent flex-1">{busy ? "저장 중…" : "저장"}</button>
            <button onClick={() => setEditing(false)} className="btn-ghost">취소</button>
          </div>
        </div>
      ) : (
        <article className="card">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {post.isNotice ? (
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">공지</span>
            ) : (
              <span className="chip">{BOARD_LABEL[post.board]}</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-900">{post.title}</h1>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-400">
            <span>{post.authorName}</span>
            <span>·</span>
            <span>{fmtDateTime(post.createdAt)}</span>
          </div>
          <div className="mt-5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-700">
            {post.content}
          </div>

          {canEdit && (
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button onClick={() => setEditing(true)} className="btn-ghost !py-1.5">수정</button>
              <button onClick={remove} className="btn-danger">삭제</button>
            </div>
          )}
        </article>
      )}
    </div>
  );
}

export default function PostDetailPage() {
  return (
    <Guard>
      <PostDetailInner />
    </Guard>
  );
}
