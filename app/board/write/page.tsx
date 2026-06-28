"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import ImagePicker from "@/components/ImagePicker";
import Select from "@/components/Select";
import Markdown from "@/components/Markdown";
import { DEFAULT_BOARD_CATEGORIES, type Post } from "@/lib/types";

const MAX_DOC_BYTES = 950_000;
const MAX_LEN = 50000;

function WriteInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const router = useRouter();
  const { settings } = useTheme();
  const categories =
    settings.boardCategories && settings.boardCategories.length > 0 ? settings.boardCategories : DEFAULT_BOARD_CATEGORIES;

  const draftKey = `board-draft-${user?.uid ?? "x"}`;
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [board, setBoard] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [asNotice, setAsNotice] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);

  // 기본 카테고리 + 임시저장 복원
  useEffect(() => {
    let usedDraft = false;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.title || d.content || d.tags) {
          setBoard(d.board || "");
          setTitle(d.title || "");
          setContent(d.content || "");
          setTags(d.tags || "");
          usedDraft = true;
          setRestored(true);
        }
      }
    } catch {
      /* 무시 */
    }
    if (!usedDraft) setBoard(categories[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function wrap(prefix: string, suffix = prefix) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = content.slice(s, e) || "텍스트";
    const next = content.slice(0, s) + prefix + sel + suffix + content.slice(e);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + prefix.length;
      ta.selectionEnd = s + prefix.length + sel.length;
    });
  }
  function prefixLine(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = content.lastIndexOf("\n", s - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
    });
  }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ board, title, content, tags }));
      setRestored(true);
      alert("임시 저장했어요. 다음에 글쓰기를 열면 이어서 작성할 수 있어요.");
    } catch {
      alert("임시 저장에 실패했어요.");
    }
  }
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* 무시 */
    }
  }

  async function submit() {
    if (!board) {
      alert("게시판을 선택해 주세요.");
      return;
    }
    if (!title.trim() || !content.trim()) {
      alert("제목과 내용을 입력해 주세요.");
      return;
    }
    if (images.length > 0 && JSON.stringify(images).length > MAX_DOC_BYTES) {
      alert("첨부한 사진 용량이 너무 큽니다. 사진 수를 줄여주세요.");
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
        hasImages: images.length > 0,
        tags: tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
        authorUid: user?.uid ?? "",
        authorName: profile?.name || profile?.displayName || "",
        authorAvatar: profile?.avatar || "",
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "posts", id), post);
      if (images.length > 0) {
        await setDoc(doc(db, "postMedia", id), { images, authorUid: user?.uid });
      }
      clearDraft();
      router.replace(`/board/${id}`);
    } finally {
      setBusy(false);
    }
  }

  const TBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">글쓰기</h1>
        <Link href="/board" className="text-sm font-medium text-slate-500 hover:text-slate-900">← 목록</Link>
      </div>

      {restored && (
        <p className="text-xs text-slate-400">임시 저장된 글을 불러왔어요.</p>
      )}

      <div className="card space-y-3">
        <Select value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="" disabled>게시판을 선택해 주세요</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>

        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />

        {/* 간단 서식 툴바 */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-surface p-1">
          <TBtn onClick={() => wrap("**")} label="굵게" />
          <TBtn onClick={() => wrap("*")} label="기울임" />
          <TBtn onClick={() => wrap("~~")} label="취소선" />
          <TBtn onClick={() => prefixLine("- ")} label="• 목록" />
          <TBtn onClick={() => prefixLine("> ")} label="❝ 인용" />
          <TBtn onClick={() => wrap("[", "](https://)")} label="링크" />
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className={`ml-auto rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${preview ? "bg-accent text-accent-fg" : "text-slate-600 hover:bg-slate-100"}`}
          >
            미리보기
          </button>
        </div>

        {preview ? (
          <div className="min-h-[200px] rounded-xl border border-slate-200 p-3 text-[15px] text-slate-700">
            {content.trim() ? <Markdown text={content} /> : <span className="text-slate-400">미리볼 내용이 없어요.</span>}
          </div>
        ) : (
          <textarea
            ref={taRef}
            className="input min-h-[240px]"
            value={content}
            maxLength={MAX_LEN}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"내용을 입력하세요.\n**굵게**  *기울임*  > 인용  - 목록  처럼 간단 서식을 쓸 수 있어요."}
          />
        )}
        <p className="text-right text-xs text-slate-400">{content.length.toLocaleString()} / {MAX_LEN.toLocaleString()}</p>

        <div>
          <label className="label">사진 첨부</label>
          <ImagePicker images={images} onChange={setImages} />
        </div>

        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그 (띄어쓰기/쉼표로 구분 — 예: 의상 1막 회의)" />

        {isAdmin && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={asNotice} onChange={(e) => setAsNotice(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            📢 공지로 등록 (모든 게시판 상단에 고정)
          </label>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={saveDraft} className="btn-ghost">임시 저장</button>
        <button onClick={submit} disabled={busy} className="btn-accent flex-1">
          {busy ? "등록 중…" : "등록"}
        </button>
      </div>
    </div>
  );
}

export default function WritePage() {
  return (
    <Guard>
      <WriteInner />
    </Guard>
  );
}
