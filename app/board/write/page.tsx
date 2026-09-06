"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import Select from "@/components/Select";
import RichEditor from "@/components/RichEditor";
import PollComposer, { EMPTY_POLL, type PollDraft } from "@/components/PollComposer";
import { savePostMedia, usedMediaIds, type MediaMap } from "@/lib/post-media";
import { htmlToText, sanitizeRichHtml } from "@/lib/sanitize";
import { clearSearchCache } from "@/lib/search";
import { pushToAll } from "@/lib/push";
import { DEFAULT_BOARD_CATEGORIES, type Poll, type Post } from "@/lib/types";

const MAX_LEN = 50000;

function WriteInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings } = useTheme();
  const categories =
    settings.boardCategories && settings.boardCategories.length > 0 ? settings.boardCategories : DEFAULT_BOARD_CATEGORIES;

  const draftKey = `board-draft-${user?.uid ?? "x"}`;

  const [board, setBoard] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState(""); // HTML
  const [tags, setTags] = useState("");
  const [media, setMedia] = useState<MediaMap>({});
  const [asNotice, setAsNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);

  // 투표 — null이면 이 글에 투표가 없다. 카드는 편집기 바로 아래에 붙는다.
  const [poll, setPoll] = useState<PollDraft | null>(null);

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
    if (!usedDraft) {
      const cat = searchParams.get("cat");
      setBoard(cat && categories.includes(cat) ? cat : categories[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textLen = htmlToText(content).length;

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
    const cleanContent = sanitizeRichHtml(content);
    if (!title.trim() || htmlToText(cleanContent).trim() === "") {
      alert("제목과 내용을 입력해 주세요.");
      return;
    }
    // 투표 구성 (켠 경우 선택지 2개 이상 필수)
    let builtPoll: Poll | undefined;
    if (poll) {
      const opts = poll.options.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) {
        alert("투표 선택지를 2개 이상 입력해 주세요.");
        return;
      }
      builtPoll = {
        options: opts,
        multiple: poll.multiple,
        anonymous: poll.anonymous,
        ...(poll.deadline ? { deadline: poll.deadline } : {}),
      };
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const now = Date.now();
      const post: Omit<Post, "id"> = {
        board,
        isNotice: isAdmin ? asNotice : false,
        title: title.trim(),
        content: cleanContent,
        hasImages: usedMediaIds(cleanContent).length > 0,
        tags: tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
        ...(builtPoll ? { poll: builtPoll } : {}),
        authorUid: user?.uid ?? "",
        authorName: profile?.name || profile?.displayName || "",
        authorAvatar: profile?.avatar || "",
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      // 사진을 먼저 올려야 규칙(작성자 확인)이 통과한다 — 폰 편집기와 같은 순서다
      await savePostMedia(id, cleanContent, media, user?.uid ?? "");
      await setDoc(doc(db, "posts", id), post);
      clearSearchCache(); // 방금 쓴 글이 검색에 바로 잡히도록
      // 공지만 푸시로 알린다. 일반 글까지 울리면 알림이 너무 잦다.
      if (post.isNotice) {
        // 길이가 변하는 글 제목은 제목줄에 — 본문에 두면 줄바꿈돼 알림이 네 줄이 된다
        void pushToAll({
          title: `📢 공지 · ${post.title}`,
          body: "새 공지가 올라왔어요.",
          href: `/board/${id}`,
          tag: "notice",
        });
      }
      clearDraft();
      router.replace(`/board/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">글쓰기</h1>
        <Link href="/board" className="text-sm font-medium text-slate-500 hover:text-slate-900">← 목록</Link>
      </div>

      {restored && <p className="text-xs text-slate-400">임시 저장된 글을 불러왔어요.</p>}

      <div className="card space-y-3">
        <Select value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="" disabled>게시판을 선택해 주세요</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>

        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />

        {/* 사진·투표는 툴바 안에 있다 (폰 편집기와 같은 자리).
            예전엔 편집기 밖에 갤러리가 따로 있어 사진이 글 끝에만 붙었는데,
            이제 커서 자리에 글자처럼 끼워 넣는다. */}
        <RichEditor
          value={content}
          onChange={setContent}
          media={media}
          onMedia={setMedia}
          pollOn={!!poll}
          onTogglePoll={() => setPoll((p) => (p ? null : { ...EMPTY_POLL }))}
        />
        <p className="text-right text-xs text-slate-400">{textLen.toLocaleString()} / {MAX_LEN.toLocaleString()}</p>

        {poll && <PollComposer value={poll} onChange={setPoll} onRemove={() => setPoll(null)} />}

        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그 (띄어쓰기/쉼표로 구분)" />

        {isAdmin && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={asNotice} onChange={(e) => setAsNotice(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            <span className="tf">📢</span> 공지로 등록 (모든 게시판 상단에 고정)
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
      <Suspense>
        <WriteInner />
      </Suspense>
    </Guard>
  );
}
