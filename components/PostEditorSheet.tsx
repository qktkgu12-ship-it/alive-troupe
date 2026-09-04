"use client";

// 게시판 글쓰기 · 수정 — 화면을 통째로 덮는 시트 (모바일)
//
// 구성
//   상단  : 취소(키보드 올라오면 '키보드 내리기') · 게시판 이름 · 등록
//   본문  : 제목 + 내용(contentEditable). 사진은 본문 안에 글자처럼 들어간다
//   하단  : 사진 · 글자서식 · 정렬 · 더보기 … 임시저장
//           서식/더보기는 툴바 위로 미끄러져 올라온다
//
// 키보드가 올라오면 visualViewport 높이가 줄어드는데, 시트 높이를 그 값에 맞춰
// 두면 툴바가 늘 키보드 바로 위에 붙는다.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useViewportHeight } from "@/lib/use-viewport-height";
import { compressImage } from "@/components/ImagePicker";
import BottomSheet from "@/components/BottomSheet";
import Spinner from "@/components/Spinner";
import { htmlToText, sanitizeRichHtml } from "@/lib/sanitize";
import { clearSearchCache } from "@/lib/search";
import { pushToAll } from "@/lib/push";
import {
  MAX_IMAGES,
  hydrateMedia,
  loadPostMedia,
  savePostMedia,
  usedMediaIds,
  type MediaMap,
} from "@/lib/post-media";
import { DEFAULT_BOARD_CATEGORIES, type Poll, type Post } from "@/lib/types";
import {
  AlignIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  DotsIcon,
  KeyboardDownIcon,
  LinkIcon,
  ListBulletIcon,
  ListOrderedIcon,
  PollIcon,
  QuoteIcon,
  TextIcon,
  XIcon,
} from "@/components/Icons";

const MAX_LEN = 50000;

type Align = "left" | "center" | "right";
const ALIGN_CYCLE: Align[] = ["left", "center", "right"];

const FONT_SIZES = [
  { label: "작게", value: "2" },
  { label: "보통", value: "3" },
  { label: "크게", value: "4" },
  { label: "아주 크게", value: "5" },
];

export type EditorTarget = { post: Post; onSaved?: (p: Post) => void } | { cat?: string } | null;

export default function PostEditorSheet({
  open,
  target,
  onClose,
}: {
  open: boolean;
  target: EditorTarget;
  onClose: () => void;
}) {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const router = useRouter();
  const { settings } = useTheme();
  const categories =
    settings.boardCategories && settings.boardCategories.length > 0
      ? settings.boardCategories
      : DEFAULT_BOARD_CATEGORIES;

  const editing = !!(target && "post" in target) ? (target as { post: Post }).post : null;
  const vh = useViewportHeight(open);

  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [sizeLeft, setSizeLeft] = useState(0);
  const savedRange = useRef<Range | null>(null);

  const [board, setBoard] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [asNotice, setAsNotice] = useState(false);
  const [align, setAlign] = useState<Align>("left");
  const [media, setMedia] = useState<MediaMap>({});
  const [imgBusy, setImgBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // 열려 있는 패널: 글자서식 / 더보기
  const [panel, setPanel] = useState<null | "text" | "more">(null);
  // 지금 글자 크기 (버튼에는 이것만 보이고, 누르면 목록이 펼쳐진다)
  const [fontSize, setFontSize] = useState("3");
  const [sizeOpen, setSizeOpen] = useState(false);
  // 아래에서 올라오는 애니메이션
  const [enter, setEnter] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);

  // 투표
  const [pollOn, setPollOn] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pollDeadline, setPollDeadline] = useState("");

  // 사진 삭제 오버레이
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgOverlayPos, setImgOverlayPos] = useState<CSSProperties>({});

  const draftKey = `board-draft-${user?.uid ?? "x"}`;

  // 키보드가 올라왔는지 — 보이는 높이가 크게 줄면 올라온 것으로 본다
  const kbOpen = typeof window !== "undefined" && !!vh && window.innerHeight - vh > 120;

  /* ── 열릴 때 초기화 ─────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    let alive = true;

    (async () => {
      if (editing) {
        setBoard(editing.board);
        setTitle(editing.title);
        setTags((editing.tags ?? []).join(" "));
        setAsNotice(!!editing.isNotice);
        setAlign(readAlign(editing.content));
        setPollOn(!!editing.poll);
        if (editing.poll) {
          setPollOptions(editing.poll.options);
          setPollMultiple(!!editing.poll.multiple);
          setPollAnonymous(!!editing.poll.anonymous);
        }
        // 본문에 들어 있는 사진을 채워 넣는다
        const { media: m, legacy } = await loadPostMedia(editing.id);
        if (!alive) return;
        // 구버전 글: 본문 밖에 갤러리로 붙어 있던 사진을 본문 끝으로 옮긴다
        const extra: MediaMap = {};
        let html = editing.content;
        legacy.forEach((src, i) => {
          const mid = `legacy${i}`;
          extra[mid] = src;
          html += `<div><img data-mid="${mid}"></div>`;
        });
        const all = { ...m, ...extra };
        setMedia(all);
        if (bodyRef.current) bodyRef.current.innerHTML = hydrateMedia(html, all);
      } else {
        // 새 글 — 임시 저장된 게 있으면 이어서
        let draft: { board?: string; title?: string; content?: string; tags?: string; media?: MediaMap } | null = null;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) draft = JSON.parse(raw);
        } catch {
          /* 무시 */
        }
        const cat = target && "cat" in target ? target.cat : undefined;
        if (draft && (draft.title || draft.content)) {
          setBoard(draft.board || cat || categories[0] || "");
          setTitle(draft.title || "");
          setTags(draft.tags || "");
          setMedia(draft.media || {});
          setAlign(readAlign(draft.content || ""));
          if (bodyRef.current) bodyRef.current.innerHTML = hydrateMedia(draft.content || "", draft.media || {});
        } else {
          setBoard(cat && categories.includes(cat) ? cat : categories[0] || "");
          setTitle("");
          setTags("");
          setMedia({});
          setAlign("left");
          if (bodyRef.current) bodyRef.current.innerHTML = "";
        }
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 열려 있는 동안 뒤 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // 열릴 때마다 패널은 닫아 둔다
  useEffect(() => {
    if (!open) {
      setPanel(null);
      setOptionsOpen(false);
      setPollOpen(false);
      setSizeOpen(false);
      setEnter(false);
      setSelectedImg(null);
    }
  }, [open]);

  // 아래에서 미끄러져 올라온 뒤 곧바로 키보드를 띄운다
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEnter(true));
    // 시트가 다 올라온 뒤 포커스를 줘야 키보드가 화면을 밀지 않는다
    const t = setTimeout(() => titleRef.current?.focus(), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [open]);

  /* ── 본문 편집 도구 ─────────────────────────────── */

  // 커서 위치를 기억해 둔다 (툴바를 누르면 본문에서 포커스가 빠지므로)
  const rememberCaret = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && bodyRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreCaret = useCallback(() => {
    bodyRef.current?.focus();
    const r = savedRange.current;
    if (!r) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }, []);

  // 커서가 보이는 영역 밖으로 나가면 스크롤을 따라간다
  const scrollToCaret = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // 빈 줄이면 임시 span을 넣어 좌표를 잡는다
    let rect = range.getBoundingClientRect();
    if (rect.height === 0) {
      const marker = document.createElement("span");
      marker.textContent = "​";
      range.insertNode(marker);
      rect = marker.getBoundingClientRect();
      marker.remove();
      // 커서를 원래 자리로 복구
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const scRect = sc.getBoundingClientRect();
    // 커서 아래쪽이 스크롤 영역 아래 40px 여유 밖이면 내린다
    const bottom = rect.bottom - scRect.top + sc.scrollTop;
    const visibleBottom = sc.scrollTop + sc.clientHeight;
    if (bottom + 40 > visibleBottom) {
      sc.scrollTo({ top: bottom - sc.clientHeight + 40, behavior: "smooth" });
    }
    // 커서 위쪽이 스크롤 영역 위로 올라갔으면 올린다
    const top = rect.top - scRect.top + sc.scrollTop;
    if (top - 20 < sc.scrollTop) {
      sc.scrollTo({ top: Math.max(0, top - 20), behavior: "smooth" });
    }
  }, []);

  const cmd = useCallback(
    (command: string, arg?: string) => {
      restoreCaret();
      document.execCommand(command, false, arg);
      rememberCaret();
    },
    [restoreCaret, rememberCaret]
  );

  /* ── 사진 삭제 ───────────────────────────────────── */
  const handleBodyClick = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "IMG" && (el as HTMLImageElement).dataset.mid) {
      e.preventDefault();
      e.stopPropagation();
      const img = el as HTMLImageElement;
      const scrollEl = img.closest(".overflow-y-auto");
      const scrollRect = scrollEl?.getBoundingClientRect();
      const rect = img.getBoundingClientRect();
      if (scrollRect) {
        setImgOverlayPos({
          top: rect.top - scrollRect.top + (scrollEl?.scrollTop ?? 0),
          left: rect.left - scrollRect.left,
          width: rect.width,
          height: rect.height,
        });
      }
      setSelectedImg(img);
    } else {
      setSelectedImg(null);
    }
  }, []);

  function deleteSelectedImg() {
    if (!selectedImg) return;
    const mid = selectedImg.dataset.mid;
    // 이미지를 감싸는 div까지 지운다
    const parent = selectedImg.parentElement;
    if (parent && parent !== bodyRef.current && parent.tagName === "DIV") {
      parent.remove();
    } else {
      selectedImg.remove();
    }
    if (mid) setMedia((prev) => { const n = { ...prev }; delete n[mid]; return n; });
    setSelectedImg(null);
    rememberCaret();
  }

  /* ── 사진 추가 ─────────────────────────────────── */
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const current = usedMediaIds(bodyRef.current?.innerHTML || "").length;
    const room = MAX_IMAGES - current;
    if (room <= 0) {
      alert(`사진은 최대 ${MAX_IMAGES}장까지 넣을 수 있어요.`);
      return;
    }
    const list = Array.from(files).slice(0, room);
    if (files.length > room) alert(`사진은 최대 ${MAX_IMAGES}장까지예요. ${room}장만 넣을게요.`);

    setImgBusy(true);
    try {
      const next: MediaMap = {};
      let html = "";
      for (const f of list) {
        const src = await compressImage(f);
        const mid = crypto.randomUUID().slice(0, 8);
        next[mid] = src;
        html += `<div><img data-mid="${mid}" src="${src}"></div>`;
      }
      setMedia((prev) => ({ ...prev, ...next }));
      // 커서 자리에 끼워 넣는다 — 사진도 글자와 같은 흐름 안에 놓인다
      restoreCaret();
      document.execCommand("insertHTML", false, html + "<div><br></div>");
      rememberCaret();
    } catch {
      alert("사진을 불러오지 못했어요. 다른 사진으로 시도해 주세요.");
    } finally {
      setImgBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /* ── 저장 ───────────────────────────────────────── */

  // 본문 HTML을 저장용으로 다듬는다: 정렬을 감싸고 사진 src를 떼어낸다
  function buildContent(): string {
    const raw = bodyRef.current?.innerHTML || "";
    const wrapped = align === "left" ? raw : `<div style="text-align:${align}">${raw}</div>`;
    return sanitizeRichHtml(wrapped); // sanitize가 img의 src를 떼고 data-mid만 남긴다
  }

  function saveDraft() {
    if (editing) {
      alert("수정 중에는 임시 저장을 쓸 수 없어요.");
      return;
    }
    try {
      const content = buildContent();
      // 본문에 남은 사진만 함께 보관
      const keep: MediaMap = {};
      usedMediaIds(content).forEach((mid) => {
        if (media[mid]) keep[mid] = media[mid];
      });
      localStorage.setItem(draftKey, JSON.stringify({ board, title, content, tags, media: keep }));
      alert("임시 저장했어요. 다음에 글쓰기를 열면 이어서 작성할 수 있어요.");
    } catch {
      alert("임시 저장에 실패했어요. 사진이 많으면 저장되지 않을 수 있어요.");
    }
  }

  function buildPoll(): Poll | undefined | "invalid" {
    if (!pollOn) return undefined;
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return "invalid";
    const dl = pollDeadline ? new Date(pollDeadline).getTime() : 0;
    return { options: opts, multiple: pollMultiple, anonymous: pollAnonymous, ...(dl ? { deadline: dl } : {}) };
  }

  async function submit() {
    if (!board) {
      alert("게시판을 선택해 주세요.");
      return;
    }
    const content = buildContent();
    const hasImage = usedMediaIds(content).length > 0;
    if (!title.trim() || (htmlToText(content).trim() === "" && !hasImage)) {
      alert("제목과 내용을 입력해 주세요.");
      return;
    }
    if (htmlToText(content).length > MAX_LEN) {
      alert(`내용은 ${MAX_LEN.toLocaleString()}자까지 쓸 수 있어요.`);
      return;
    }
    const poll = buildPoll();
    if (poll === "invalid") {
      alert("투표 선택지를 2개 이상 입력해 주세요.");
      return;
    }

    setBusy(true);
    try {
      const now = Date.now();
      if (editing) {
        const update = {
          board,
          title: title.trim(),
          content,
          hasImages: hasImage,
          isNotice: isAdmin ? asNotice : false,
          tags: parseTags(tags),
          ...(poll ? { poll } : {}),
          updatedAt: now,
        };
        await updateDoc(doc(db, "posts", editing.id), update);
        await savePostMedia(editing.id, content, media, user?.uid ?? "");
        clearSearchCache();
        const cb = (target as { onSaved?: (p: Post) => void }).onSaved;
        cb?.({ ...editing, ...update } as Post);
        close();
      } else {
        const id = crypto.randomUUID();
        const post: Omit<Post, "id"> = {
          board,
          isNotice: isAdmin ? asNotice : false,
          title: title.trim(),
          content,
          hasImages: hasImage,
          tags: parseTags(tags),
          ...(poll ? { poll } : {}),
          authorUid: user?.uid ?? "",
          authorName: profile?.name || profile?.displayName || "",
          authorAvatar: profile?.avatar || "",
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        // 사진을 먼저 올려야 규칙(작성자 확인)이 통과한다
        await savePostMedia(id, content, media, user?.uid ?? "");
        await setDoc(doc(db, "posts", id), post);
        clearSearchCache();
        if (post.isNotice) {
          void pushToAll({ title: "📢 새 공지", body: post.title, href: `/board/${id}`, tag: "notice" });
        }
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* 무시 */
        }
        close();
        router.push(`/board/${id}`);
      }
    } catch {
      alert("등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (kbOpen) {
      // 키보드만 내린다
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const dirty = title.trim() || htmlToText(bodyRef.current?.innerHTML || "").trim();
    if (dirty && !confirm("작성 중인 내용이 사라져요. 나갈까요?")) return;
    close();
  }

  // 아래로 미끄러져 내려간 다음 닫는다
  function close() {
    setEnter(false);
    setTimeout(onClose, 260);
  }

  if (!open) return null;

  const ToolBtn = ({
    onClick,
    label,
    active,
    children,
  }: {
    onClick: () => void;
    label: string;
    active?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
        active ? "bg-slate-900/[0.07] text-slate-900" : "text-slate-600 active:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );

  const sizeLabel = FONT_SIZES.find((f) => f.value === fontSize)?.label ?? "보통";

  return (
    <div className="fixed inset-0 z-[80]">
      {/* 뒷배경 — 시트가 올라오면서 같이 어두워진다 */}
      <div
        className="absolute inset-0 bg-slate-900/30 transition-opacity duration-300"
        style={{ opacity: enter ? 1 : 0 }}
        aria-hidden
      />

      {/*
       * 시트 본체 — 아래에서 위로 올라온다.
       * 화면을 끝까지 덮으므로 키보드가 올라와도 뒤 페이지가 비치지 않는다.
       */}
      <div
        className="absolute inset-0 flex flex-col bg-canvas"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          transform: enter ? "translateY(0)" : "translateY(100%)",
          transition: "transform 340ms cubic-bezier(0.32, 0.94, 0.28, 1)",
        }}
      >
        {/* ── 상단: 취소 · 게시판 · 등록 ── */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-2">
          <button
            onClick={handleCancel}
            className="grid h-10 min-w-[52px] place-items-center rounded-xl px-2 text-[15px] font-semibold text-slate-600 active:bg-slate-100"
            aria-label={kbOpen ? "키보드 내리기" : "취소"}
          >
            {kbOpen ? <KeyboardDownIcon className="h-[22px] w-[22px]" /> : "취소"}
          </button>

          <button
            onClick={() => {
              (document.activeElement as HTMLElement | null)?.blur();
              setOptionsOpen(true);
            }}
            className="flex min-w-0 items-center gap-1 rounded-xl px-2 py-1.5 active:bg-slate-100"
          >
            <span className="truncate text-[17px] font-bold text-slate-900">{board || "게시판"}</span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-500" />
          </button>

          <button
            onClick={submit}
            disabled={busy}
            className="grid h-10 min-w-[52px] place-items-center rounded-xl px-2 text-[15px] font-bold text-accent active:bg-slate-100 disabled:text-slate-300"
          >
            {busy ? <Spinner className="h-5 w-5" /> : editing ? "수정" : "등록"}
          </button>
        </header>

        {/* ── 제목 ── */}
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="w-full shrink-0 border-b border-slate-100 bg-white px-4 py-4 text-[22px] font-bold outline-none placeholder:text-slate-300"
        />

        {/* ── 툴바 (제목 바로 아래) ── */}
        <div className="relative z-10 flex h-[52px] shrink-0 items-center gap-0.5 border-b border-slate-200 bg-white px-2">
          <ToolBtn onClick={() => fileRef.current?.click()} label="사진 추가">
            {imgBusy ? <Spinner className="h-5 w-5" /> : <CameraIcon className="h-[22px] w-[22px]" />}
          </ToolBtn>
          <ToolBtn
            onClick={() => { setSizeOpen(false); setPanel((p) => (p === "text" ? null : "text")); }}
            label="글자 서식"
            active={panel === "text"}
          >
            <TextIcon className="h-[21px] w-[21px]" />
          </ToolBtn>
          {/* 정렬 — 누를 때마다 왼쪽→가운데→오른쪽, 글 전체가 바로 바뀐다 */}
          <ToolBtn
            onClick={() => setAlign((a) => ALIGN_CYCLE[(ALIGN_CYCLE.indexOf(a) + 1) % 3])}
            label={`정렬 (지금 ${align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽"})`}
          >
            <AlignIcon align={align} className="h-[21px] w-[21px]" />
          </ToolBtn>
          <ToolBtn
            onClick={() => { setSizeOpen(false); setPanel((p) => (p === "more" ? null : "more")); }}
            label="더보기"
            active={panel === "more"}
          >
            <DotsIcon className="h-[21px] w-[21px]" />
          </ToolBtn>

          <button
            onClick={saveDraft}
            className="ml-auto rounded-xl px-3 py-2 text-[15px] font-semibold text-slate-500 active:bg-slate-100"
          >
            저장
          </button>
        </div>

        {/* ── 툴바 아래로 미끄러져 내려오는 하위 툴바 ──
             글을 쓰는 동안에도 닫히지 않고 그대로 남는다 */}
        <div
          ref={panelRef}
          className="relative shrink-0 overflow-visible bg-white transition-[height] duration-250 ease-out"
          style={{ height: panel ? 52 : 0 }}
        >
          <div className={`h-[52px] overflow-hidden${panel ? " border-b border-slate-100" : ""}`}>
            {panel === "text" && (
              <div className="flex h-[52px] items-center gap-0.5 overflow-x-auto px-2">
                <ToolBtn onClick={() => cmd("bold")} label="굵게"><span className="text-[16px] font-bold">B</span></ToolBtn>
                <ToolBtn onClick={() => cmd("italic")} label="기울임"><span className="font-serif text-[16px] italic">I</span></ToolBtn>
                <ToolBtn onClick={() => cmd("underline")} label="밑줄"><span className="text-[16px] underline">U</span></ToolBtn>
                <ToolBtn onClick={() => cmd("strikeThrough")} label="취소선"><span className="text-[16px] line-through">S</span></ToolBtn>
                <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
                {/* 글자 크기 — 지금 크기만 보이고, 누르면 목록이 펼쳐진다 */}
                <button
                  ref={sizeBtnRef}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // 버튼이 지금 있는 자리 바로 아래에 목록을 편다
                    const b = sizeBtnRef.current?.getBoundingClientRect();
                    const p = panelRef.current?.getBoundingClientRect();
                    if (b && p) setSizeLeft(Math.max(8, Math.min(b.left - p.left, p.width - 120)));
                    setSizeOpen((v) => !v);
                  }}
                  className={`flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition ${
                    sizeOpen ? "bg-slate-900/[0.07] text-slate-900" : "text-slate-600 active:bg-slate-100"
                  }`}
                >
                  {sizeLabel}
                  <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${sizeOpen ? "rotate-180" : ""}`} />
                </button>
                <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
                <ToolBtn onClick={() => cmd("insertUnorderedList")} label="목록"><ListBulletIcon className="h-[19px] w-[19px]" /></ToolBtn>
                <ToolBtn onClick={() => cmd("insertOrderedList")} label="번호 목록"><ListOrderedIcon className="h-[19px] w-[19px]" /></ToolBtn>
                <ToolBtn onClick={() => cmd("formatBlock", "blockquote")} label="인용"><QuoteIcon className="h-[19px] w-[19px]" /></ToolBtn>
              </div>
            )}

            {panel === "more" && (
              <div className="flex h-[52px] items-center gap-1 px-2">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const url = prompt("링크 주소(https://...)를 입력하세요");
                    if (!url) return;
                    if (!/^https?:\/\//i.test(url)) {
                      alert("http(s) 주소만 넣을 수 있어요.");
                      return;
                    }
                    cmd("createLink", url);
                  }}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] font-semibold text-slate-700 active:bg-slate-100"
                >
                  <LinkIcon className="h-[18px] w-[18px]" /> 링크
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    (document.activeElement as HTMLElement | null)?.blur();
                    setPollOpen(true);
                  }}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] font-semibold text-slate-700 active:bg-slate-100"
                >
                  <PollIcon className="h-[18px] w-[18px]" /> 투표
                  {pollOn && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-accent-fg">켜짐</span>}
                </button>
              </div>
            )}
          </div>

          {/* 글자 크기 드롭다운 */}
          {panel === "text" && sizeOpen && (
            <div
              className="absolute top-[46px] z-20 min-w-[112px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              style={{ left: sizeLeft }}
            >
              {FONT_SIZES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setFontSize(f.value);
                    cmd("fontSize", f.value);
                    setSizeOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] ${
                    f.value === fontSize ? "font-bold text-accent" : "font-medium text-slate-700"
                  }`}
                >
                  {f.value === fontSize ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 본문 ──
             남은 자리를 전부 차지해서, 키보드가 올라와도 뒤가 비치지 않는다 */}
        <div ref={scrollRef} className="editor-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4">
          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            onKeyUp={() => { rememberCaret(); scrollToCaret(); }}
            onMouseUp={rememberCaret}
            onClick={handleBodyClick}
            onInput={() => {
              rememberCaret();
              setSizeOpen(false);
              setSelectedImg(null);
              scrollToCaret();
            }}
            data-placeholder="내용을 입력하세요"
            style={{ textAlign: align }}
            className="rich min-h-[70vh] w-full py-4 text-[16px] leading-relaxed outline-none empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)] [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl"
          />
          {/* 사진 삭제 오버레이 */}
          {selectedImg && (
            <div
              className="pointer-events-none absolute z-10 flex items-center justify-center rounded-xl bg-black/40"
              style={imgOverlayPos}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); deleteSelectedImg(); }}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-[14px] font-semibold text-red-600 shadow-lg backdrop-blur active:bg-white"
              >
                <XIcon className="h-4 w-4" />
                삭제
              </button>
            </div>
          )}
          {/* 키보드가 내려가 있을 때도 아래가 흰 화면으로 이어지도록 */}
          <div className="h-[40vh]" />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {/* ── 게시판 종류 · 태그 · 공지 ── */}
      <BottomSheet open={optionsOpen} title="글 설정" onClose={() => setOptionsOpen(false)}>
        <p className="label">게시판</p>
        <div className="flex flex-wrap gap-2 pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setBoard(c)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[14px] font-semibold transition ${
                board === c ? "bg-accent text-accent-fg" : "bg-surface text-slate-600"
              }`}
            >
              {board === c && <CheckIcon className="h-3.5 w-3.5" />}
              {c}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <p className="label">태그</p>
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="태그 (띄어쓰기/쉼표로 구분)"
          />
          {parseTags(tags).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parseTags(tags).map((t) => (
                <span key={t} className="rounded-full bg-surface px-2.5 py-1 text-[13px] font-medium text-slate-500">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {isAdmin && (
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={asNotice}
              onChange={(e) => setAsNotice(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent))]"
            />
            <span className="tf">📢</span> 공지로 등록 (모든 게시판 상단에 고정)
          </label>
        )}
      </BottomSheet>

      {/* ── 투표 ── */}
      <BottomSheet open={pollOpen} title="투표" onClose={() => setPollOpen(false)}>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={pollOn}
            onChange={(e) => setPollOn(e.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--accent))]"
          />
          이 글에 투표 넣기
        </label>

        {pollOn && (
          <div className="mt-3 space-y-2">
            {pollOptions.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input"
                  value={opt}
                  onChange={(e) => setPollOptions((p) => p.map((o, j) => (j === i ? e.target.value : o)))}
                  placeholder={`선택지 ${i + 1}`}
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions((p) => p.filter((_, j) => j !== i))}
                    aria-label="선택지 삭제"
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-slate-400 active:bg-slate-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 10 && (
              <button
                type="button"
                onClick={() => setPollOptions((p) => [...p, ""])}
                className="text-sm font-semibold text-accent"
              >
                + 선택지 추가
              </button>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                복수 선택 허용
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={pollAnonymous} onChange={(e) => setPollAnonymous(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                익명 투표
              </label>
            </div>
            <div>
              <p className="label">마감일 (선택)</p>
              <input type="datetime-local" className="input" value={pollDeadline} onChange={(e) => setPollDeadline(e.target.value)} />
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* ── 잡다한 도우미 ─────────────────────────────── */

function parseTags(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

// 저장할 때 감싼 정렬용 div에서 정렬 값을 되읽는다.
// 브라우저마다 style 문자열을 다르게 다시 쓰므로(띄어쓰기·세미콜론) DOM으로 읽는다.
function readAlign(html: string): Align {
  if (typeof document === "undefined") return "left";
  const d = document.createElement("div");
  d.innerHTML = html || "";
  const first = d.firstElementChild as HTMLElement | null;
  const a = first?.style.textAlign;
  return a === "center" || a === "right" ? a : "left";
}
