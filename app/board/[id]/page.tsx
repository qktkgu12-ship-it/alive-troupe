"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, increment, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import ImagePicker from "@/components/ImagePicker";
import Linkify from "@/components/Linkify";
import PostContent from "@/components/PostContent";
import RichEditor from "@/components/RichEditor";
import { ProfileAvatar } from "@/components/ProfileViewer";
import { CommentIcon, EyeIcon, HeartIcon, PencilIcon, TrashIcon } from "@/components/Icons";
import { relativeTime } from "@/lib/utils";
import { htmlToText, sanitizeRichHtml } from "@/lib/sanitize";
import { boardCategoryLabel, type Comment, type Post, type PostMedia, type PollVote } from "@/lib/types";

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

  // 같은 게시판 안에서의 이전/다음 글
  const [prevPost, setPrevPost] = useState<{ id: string; title: string } | null>(null);
  const [nextPost, setNextPost] = useState<{ id: string; title: string } | null>(null);

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

  // 같은 게시판 글 목록에서 현재 글의 앞뒤를 찾아 이전/다음 글 링크 구성
  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "posts"), where("board", "==", post.board)));
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
          .filter((p) => !p.isNotice)
          .sort((a, b) => b.createdAt - a.createdAt); // 최신순
        const idx = list.findIndex((p) => p.id === post.id);
        if (cancelled || idx === -1) return;
        const older = list[idx + 1]; // 먼저 쓴 글 = 이전글
        const newer = list[idx - 1]; // 나중에 쓴 글 = 다음글
        setPrevPost(older ? { id: older.id, title: older.title } : null);
        setNextPost(newer ? { id: newer.id, title: newer.title } : null);
      } catch {
        /* 무시 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [post]);

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
        authorAvatar: profile?.avatar || "",
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
    const cleanContent = sanitizeRichHtml(content);
    if (!post || !title.trim() || htmlToText(cleanContent).trim() === "") return;
    if (images.length > 0 && JSON.stringify(images).length > MAX_DOC_BYTES) {
      alert("첨부한 사진 용량이 너무 큽니다. 사진 수를 줄여주세요.");
      return;
    }
    setBusy(true);
    try {
      const update = {
        title: title.trim(),
        content: cleanContent,
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
            <RichEditor value={content} onChange={setContent} />
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
              <span className="chip">{boardCategoryLabel(post.board)}</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-900">{post.title}</h1>
          <div className="mt-3 flex items-center gap-2.5">
            <ProfileAvatar uid={post.authorUid} name={post.authorName} avatar={post.authorAvatar} className="h-9 w-9 text-sm" />
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-700">{post.authorName}</p>
              <p className="text-xs text-slate-400">{fmtDateTime(post.createdAt)}</p>
            </div>
          </div>
          <PostContent content={post.content} className="mt-5 text-[15px] text-slate-700" />

          {post.tags && post.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {post.tags.map((t) => (
                <span key={t} className="chip">#{t}</span>
              ))}
            </div>
          )}

          {post.poll && <PollBlock post={post} />}

          {images.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {images.map((src, i) => (
                <button key={i} type="button" onClick={() => setZoom(src)} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" decoding="async" className="aspect-square w-full cursor-zoom-in rounded-lg border border-slate-200 object-cover transition hover:opacity-90" />
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
              <button onClick={() => setEditing(true)} aria-label="수정" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50">
                <PencilIcon className="h-4 w-4" />
              </button>
              <button onClick={remove} aria-label="삭제" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 transition hover:bg-red-50 hover:text-red-500">
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </article>
      )}

      {/* 글 네비게이션: 이전글 / 목록 / 다음글 (알약 칩, 중앙 묶음) */}
      {!editing && (
        <div className="flex items-center justify-center gap-2">
          {prevPost ? (
            <Link
              href={`/board/${prevPost.id}`}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              ‹ 이전글
            </Link>
          ) : (
            <span className="rounded-full border border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-300">
              ‹ 이전글
            </span>
          )}
          <Link
            href={`/board?cat=${encodeURIComponent(boardCategoryLabel(post.board))}`}
            className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            목록
          </Link>
          {nextPost ? (
            <Link
              href={`/board/${nextPost.id}`}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              다음글 ›
            </Link>
          ) : (
            <span className="rounded-full border border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-300">
              다음글 ›
            </span>
          )}
        </div>
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
                <div key={c.id} className="flex items-start gap-2.5 py-3">
                  <ProfileAvatar uid={c.authorUid} name={c.authorName} avatar={c.authorAvatar} className="h-8 w-8 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium text-slate-800">{c.authorName}</span>
                      <span className="ml-1.5 text-xs text-slate-400">{relativeTime(c.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">
                      <Linkify text={c.content} />
                    </p>
                  </div>
                  {(isAdmin || c.authorUid === user?.uid) && (
                    <button onClick={() => removeComment(c)} aria-label="댓글 삭제" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:text-red-500">
                      <TrashIcon className="h-4 w-4" />
                    </button>
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

// ---------- 투표 블록 ----------
function pollDeadlineLabel(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function PollBlock({ post }: { post: Post }) {
  const { user, profile } = useAuth();
  const poll = post.poll!;
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const closed = !!poll.deadline && Date.now() > poll.deadline;

  const load = useCallback(async () => {
    const snap = await getDocs(collection(db, "posts", post.id, "votes"));
    const list = snap.docs.map((d) => d.data() as PollVote);
    setVotes(list);
    const mine = list.find((v) => v.uid === user?.uid);
    setSel(mine ? mine.choices : []);
  }, [post.id, user?.uid]);
  useEffect(() => {
    load();
  }, [load]);

  const myVote = votes.find((v) => v.uid === user?.uid);
  const total = votes.length;
  const counts = poll.options.map((_, i) => votes.filter((v) => v.choices.includes(i)).length);
  const votersByOption = poll.options.map((_, i) => votes.filter((v) => v.choices.includes(i)));

  const selChanged = JSON.stringify([...sel].sort()) !== JSON.stringify([...(myVote?.choices ?? [])].sort());

  function toggle(i: number) {
    if (closed) return;
    setSel((prev) => {
      if (poll.multiple) return prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i];
      return [i];
    });
  }

  async function submit() {
    if (!user || sel.length === 0 || closed) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "posts", post.id, "votes", user.uid), {
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        avatar: profile?.avatar || "",
        choices: sel,
        createdAt: Date.now(),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function cancelVote() {
    if (!user || closed) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "posts", post.id, "votes", user.uid));
      setSel([]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">🗳️ {poll.question || "투표"}</p>
        <span className="shrink-0 text-xs text-slate-400">
          {poll.multiple ? "복수" : "단일"} · {poll.anonymous ? "익명" : "실명"}
        </span>
      </div>

      <div className="space-y-2">
        {poll.options.map((opt, i) => {
          const count = counts[i];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const chosen = sel.includes(i);
          return (
            <div key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={closed}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                  chosen ? "border-accent bg-accent-soft" : "border-slate-200 hover:bg-slate-50"
                } ${closed ? "cursor-default" : ""}`}
              >
                {/* 결과 막대 */}
                <span className="absolute inset-y-0 left-0 -z-0 bg-accent/10" style={{ width: `${pct}%` }} aria-hidden />
                <span className="relative z-10 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center border-2 ${poll.multiple ? "rounded" : "rounded-full"} ${
                        chosen ? "border-accent bg-accent text-accent-fg" : "border-slate-300"
                      }`}
                    >
                      {chosen && <span className="text-[9px] leading-none">✓</span>}
                    </span>
                    <span className={chosen ? "font-semibold text-slate-900" : "text-slate-700"}>{opt}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-slate-500">
                    {count}표 · {pct}%
                  </span>
                </span>
              </button>
              {/* 실명 투표면 각 선택지에 투표자 표시 */}
              {!poll.anonymous && votersByOption[i].length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1 pl-1">
                  {votersByOption[i].slice(0, 12).map((v) => (
                    <ProfileAvatar key={v.uid} uid={v.uid} name={v.name} avatar={v.avatar} className="h-6 w-6 text-[10px]" />
                  ))}
                  {votersByOption[i].length > 12 && (
                    <span className="text-xs text-slate-400">+{votersByOption[i].length - 12}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          총 {total}명 참여
          {poll.deadline && <> · {closed ? "마감됨" : `${pollDeadlineLabel(poll.deadline)} 마감`}</>}
        </p>
        {!closed && (
          <div className="flex gap-2">
            {myVote && (
              <button onClick={cancelVote} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50">
                투표 취소
              </button>
            )}
            <button
              onClick={submit}
              disabled={busy || sel.length === 0 || !selChanged}
              className="btn-accent !py-1.5 disabled:opacity-50"
            >
              {myVote ? "변경 저장" : "투표하기"}
            </button>
          </div>
        )}
      </div>
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
