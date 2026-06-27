"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import ImagePicker from "@/components/ImagePicker";
import Linkify from "@/components/Linkify";
import Avatar from "@/components/Avatar";
import { CommentIcon, EyeIcon, HeartIcon } from "@/components/Icons";
import { relativeTime } from "@/lib/utils";
import { BOARD_LABEL, type Comment, type Post, type PostMedia } from "@/lib/types";

const MAX_DOC_BYTES = 950_000;

function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function PostDetailInner() {
  const { id } = useParams<{ id: string }>();
  const { user, profile, role } = useAuth();
  const router = useRouter();
  const isAdmin = role === "admin";

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [asNotice, setAsNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [views, setViews] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [visibleC, setVisibleC] = useState(10);
  const viewedRef = useRef(false);

  const loadComments = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "posts", id, "comments"), orderBy("createdAt", "asc")));
    setComments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, "id">) })));
  }, [id]);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "posts", id));
        if (!snap.exists()) return;
        const p = { id: snap.id, ...(snap.data() as Omit<Post, "id">) };
        setPost(p);
        setTitle(p.title);
        setContent(p.content);
        setAsNotice(p.isNotice);
        setLikeCount(p.likeCount ?? 0);
        setViews(p.viewCount ?? 0);
        // 사진: 구버전은 글 문서 안(images), 신버전은 postMedia 문서에서
        if (p.images && p.images.length > 0) {
          setImages(p.images);
        } else if (p.hasImages) {
          const m = await getDoc(doc(db, "postMedia", id));
          setImages(m.exists() ? (m.data() as PostMedia).images ?? [] : []);
        }
        // 좋아요 상태
        if (user) {
          const lk = await getDoc(doc(db, "postLikes", `${id}_${user.uid}`));
          setLiked(lk.exists());
        }
        await loadComments();
        // 조회수 +1 (한 번만)
        if (!viewedRef.current) {
          viewedRef.current = true;
          updateDoc(doc(db, "posts", id), { viewCount: increment(1) }).catch(() => {});
          setViews((v) => v + 1);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, user, loadComments]);

  async function toggleLike() {
    if (!user || !post) return;
    const ref = doc(db, "postLikes", `${id}_${user.uid}`);
    if (liked) {
      setLiked(false);
      setLikeCount((c) => Math.max(0, c - 1));
      await deleteDoc(ref).catch(() => {});
      await updateDoc(doc(db, "posts", id), { likeCount: increment(-1) }).catch(() => {});
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      await setDoc(ref, {
        postId: id,
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        createdAt: Date.now(),
      }).catch(() => {});
      await updateDoc(doc(db, "posts", id), { likeCount: increment(1) }).catch(() => {});
    }
  }

  async function addComment() {
    if (!user || !commentText.trim()) return;
    setCommentBusy(true);
    try {
      const cid = crypto.randomUUID();
      await setDoc(doc(db, "posts", id, "comments", cid), {
        authorUid: user.uid,
        authorName: profile?.name || profile?.displayName || "",
        content: commentText.trim(),
        createdAt: Date.now(),
      });
      await updateDoc(doc(db, "posts", id), { commentCount: increment(1) }).catch(() => {});
      setCommentText("");
      await loadComments();
    } finally {
      setCommentBusy(false);
    }
  }

  async function removeComment(c: Comment) {
    if (!confirm("댓글을 삭제할까요?")) return;
    await deleteDoc(doc(db, "posts", id, "comments", c.id));
    await updateDoc(doc(db, "posts", id), { commentCount: increment(-1) }).catch(() => {});
    await loadComments();
  }

  const canEdit = post && (isAdmin || post.authorUid === user?.uid);

  async function save() {
    if (!post || !title.trim() || !content.trim()) return;
    if (images.length > 0 && JSON.stringify(images).length > MAX_DOC_BYTES) {
      alert("첨부한 사진 용량이 너무 큽니다. 사진 수를 줄여주세요.");
      return;
    }
    setBusy(true);
    try {
      const update = {
        title: title.trim(),
        content: content.trim(),
        isNotice: isAdmin ? asNotice : post.isNotice,
        hasImages: images.length > 0,
        images: null, // 구버전 인라인 사진 제거(분리 저장으로 이전)
        updatedAt: Date.now(),
      };
      await setDoc(doc(db, "posts", post.id), update, { merge: true });
      // 사진은 별도 문서에 저장/갱신/삭제
      if (images.length > 0) {
        await setDoc(doc(db, "postMedia", post.id), { images, authorUid: post.authorUid });
      } else {
        await deleteDoc(doc(db, "postMedia", post.id)).catch(() => {});
      }
      setPost({ ...post, title: update.title, content: update.content, isNotice: update.isNotice, hasImages: update.hasImages, images: undefined });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!post || !confirm("이 글을 삭제할까요?")) return;
    await deleteDoc(doc(db, "posts", post.id));
    await deleteDoc(doc(db, "postMedia", post.id)).catch(() => {});
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
          <div>
            <label className="label">사진 첨부</label>
            <ImagePicker images={images} onChange={setImages} />
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
          <div className="mt-3 flex items-center gap-2.5">
            <Avatar src={post.authorAvatar} name={post.authorName} className="h-9 w-9 text-sm" />
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-700">{post.authorName}</p>
              <p className="text-xs text-slate-400">{fmtDateTime(post.createdAt)}</p>
            </div>
          </div>
          <div className="mt-5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-700">
            <Linkify text={post.content} />
          </div>

          {images.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((src, i) => (
                <button key={i} type="button" onClick={() => setZoom(src)} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="aspect-square w-full cursor-zoom-in rounded-lg border border-slate-200 object-cover transition hover:opacity-90" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-4">
            <button
              onClick={toggleLike}
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                liked ? "border-accent bg-accent-soft text-accent" : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <HeartIcon className="h-4 w-4" /> 좋아요 {likeCount}
            </button>
            <span className="inline-flex items-center gap-1 text-sm text-slate-400">
              <EyeIcon className="h-4 w-4" /> {views}
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-slate-400">
              <CommentIcon className="h-4 w-4" /> {comments.length}
            </span>
          </div>

          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(true)} className="btn-ghost !py-1.5">수정</button>
              <button onClick={remove} className="btn-danger">삭제</button>
            </div>
          )}
        </article>
      )}

      {/* 댓글 */}
      {!editing && (
        <section className="card">
          <h2 className="mb-3 font-bold">댓글 {comments.length}</h2>
          {comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">첫 댓글을 남겨보세요.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {comments.slice(0, visibleC).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium text-slate-800">{c.authorName}</span>
                      <span className="ml-1.5 text-xs text-slate-400">{relativeTime(c.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">
                      <Linkify text={c.content} />
                    </p>
                  </div>
                  {(isAdmin || c.authorUid === user?.uid) && (
                    <button onClick={() => removeComment(c)} className="shrink-0 text-xs text-red-500 hover:underline">삭제</button>
                  )}
                </div>
              ))}
              {comments.length > visibleC && (
                <button onClick={() => setVisibleC((v) => v + 10)} className="w-full py-2.5 text-sm font-medium text-accent hover:bg-slate-50">
                  댓글 더 보기 ({comments.length - visibleC}개)
                </button>
              )}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="댓글을 입력하세요"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addComment();
                }
              }}
            />
            <button onClick={addComment} disabled={commentBusy || !commentText.trim()} className="btn-accent">
              등록
            </button>
          </div>
        </section>
      )}

      {/* 사진 크게 보기 (라이트박스) */}
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button
            onClick={() => setZoom(null)}
            aria-label="닫기"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-2xl text-white transition hover:bg-white/25"
          >
            ×
          </button>
        </div>
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
