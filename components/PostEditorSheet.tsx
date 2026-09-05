"use client";

// 게시판 글쓰기 · 수정 — 화면을 통째로 덮는 시트 (모바일)
//
// 구성
//   상단  : ✕ · 게시판 알약(누르면 글 설정) ······ 게시
//   본문  : 제목 → 내용(contentEditable) → 툴바 → 임시저장
//
// ⚠️ 툴바는 화면 아래에 붙어 있지 않고 '본문 바로 밑'에 흐름대로 놓인다.
//    글이 길어지면 툴바도 같이 아래로 내려간다 (사용자가 고른 레퍼런스 형식).
//    그래서 제목·본문·툴바가 전부 같은 스크롤 영역 안에 들어 있다 —
//    툴바만 밖으로 빼면 자리가 고정돼 버려서 이 형식이 깨진다.
//
// 키보드가 올라오면 visualViewport 높이가 줄어드는데, 시트 높이를 그 값에 맞춰
// 두면 스크롤 영역이 키보드 위까지로 줄어 커서를 따라갈 수 있다.

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
import { NO_MARKS, keepMarksAcrossNewline, placeCaretAtEnd, readMarks, type Marks } from "@/lib/rich-text";
import { usePress } from "@/lib/use-press";
import {
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  KeyboardDownIcon,
  LinkIcon,
  ListBulletIcon,
  ListOrderedIcon,
  PollIcon,
  QuoteIcon,
  TextSizeIcon,
  XIcon,
} from "@/components/Icons";

const MAX_LEN = 50000;

// 정렬 버튼은 없앴다(거의 안 쓰였고 툴바 자리만 차지했다). 다만 값 자체는 남겨 둔다 —
// 예전에 가운데·오른쪽으로 맞춰 둔 글을 열었다가 저장하면 정렬이 풀려 버리기 때문이다.
type Align = "left" | "center" | "right";

// 글자 크기는 두 단계뿐이다 — 기본과 크게.
// 네 단계 목록을 펼치던 것을 없앴다: 좁은 화면에서 목록이 툴바를 가렸고,
// '작게'와 '아주 크게'는 실제로 거의 안 쓰였다.
// 값은 execCommand("fontSize")가 쓰는 1~7 척도다. 3 = 편집칸 기본 크기(16px),
// 5 = 그보다 확실히 큰 크기라 눌렀을 때 바뀐 게 눈에 보인다.
const SIZE_NORMAL = "3";
const SIZE_LARGE = "5";

export type EditorTarget = { post: Post; onSaved?: (p: Post) => void } | { cat?: string } | null;

// ⚠️ 툴바 버튼은 반드시 컴포넌트 '밖'에 둘 것.
//    안에 두면 글자를 칠 때마다 새 컴포넌트로 취급돼 툴바가 통째로 다시 그려지고,
//    그 순간 누르고 있던 버튼이 사라져 탭이 먹히지 않는다.
function ToolBtn({
  onPress,
  label,
  active,
  children,
}: {
  onPress: () => void;
  label: string;
  /** 지금 커서 자리에 이 서식이 걸려 있는가 */
  active?: boolean;
  children: React.ReactNode;
}) {
  const press = usePress(onPress);
  return (
    <button
      type="button"
      {...press}
      aria-label={label}
      aria-pressed={!!active}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
        active ? "text-accent" : "text-slate-600 active:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

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
  const savedRange = useRef<Range | null>(null);
  // 커서 자리에 걸려 있는 서식 — 툴바 버튼을 켜서 보여 준다
  const [marks, setMarks] = useState<Marks>(NO_MARKS);

  const [board, setBoard] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [asNotice, setAsNotice] = useState(false);
  const [align, setAlign] = useState<Align>("left");
  const [media, setMedia] = useState<MediaMap>({});
  const [imgBusy, setImgBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // 아래에서 올라오는 애니메이션
  const [enter, setEnter] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);

  // 링크 넣기 — 예전엔 prompt()로 물어봤는데 폰에서 안 먹혔다.
  //
  // 툴바 버튼은 usePress로 '손을 대는 순간(pointerdown)'에 반응한다. 거기서
  // prompt()를 부르면 손가락을 뗀 신호가 오기 전에 창이 떠서 화면을 붙잡고,
  // 주소를 치는 동안 usePress의 700ms 중복 방지 시간이 지나 버린다 →
  // 창을 닫는 순간 click이 뒤늦게 들어와 같은 걸 한 번 더 연다.
  // 게다가 홈 화면에 추가한 앱(PWA)에서는 이 창 자체가 안 뜨는 경우가 있다.
  // 앱 안의 시트로 바꿔서 네이티브 창에 기대는 부분을 아예 없앴다.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

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

    // 지난번에 쓴 글의 커서·서식이 남아 있으면 안 된다.
    // (이 시트는 닫혀도 화면에서 사라지지 않아 값이 그대로 남는다)
    savedRange.current = null;
    setMarks(NO_MARKS);

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
      setOptionsOpen(false);
      setPollOpen(false);
      setLinkOpen(false);
      setEnter(false);
      setSelectedImg(null);
    }
  }, [open]);

  // 아래에서 미끄러져 올라온 뒤 곧바로 제목칸에 커서를 놓는다.
  //
  // 시트가 다 올라온 뒤에 포커스를 줘야 키보드가 화면을 밀지 않는다.
  // 다만 애니메이션이 늦게 끝나는 기기가 있어 한 번 더 확인한다 —
  // 이미 제목칸에 커서가 있으면 아무 일도 안 하므로 두 번 불러도 안전하다.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEnter(true));
    const focusTitle = () => {
      const el = titleRef.current;
      if (!el || document.activeElement === el) return;
      // 편집칸을 이미 만지고 있으면 뺏지 않는다
      if (bodyRef.current && bodyRef.current.contains(document.activeElement)) return;
      el.focus();
      // 이어 쓰기(임시저장·수정)일 때 커서를 글자 끝에 둔다
      const n = el.value.length;
      try {
        el.setSelectionRange(n, n);
      } catch {
        /* 무시 */
      }
    };
    // 시트가 올라오는 것과 거의 동시에 커서를 놓는다 — 열자마자 바로 칠 수 있게.
    // 뒤의 두 번은 애니메이션이 늦게 끝나는 기기를 위한 확인용이다
    // (이미 제목칸에 커서가 있으면 아무 일도 안 하므로 여러 번 불러도 안전하다).
    const t0 = setTimeout(focusTitle, 50);
    const t1 = setTimeout(focusTitle, 380);
    const t2 = setTimeout(focusTitle, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open]);

  /* ── 본문 편집 도구 ─────────────────────────────── */

  // 커서 위치를 기억해 둔다 (툴바를 누르면 본문에서 포커스가 빠지므로)
  const rememberCaret = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && bodyRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
      setMarks(readMarks(bodyRef.current));
    }
  }, []);

  // ⚠️ selectionchange를 꼭 들어야 한다.
  //    폰에서 파란 손잡이를 끌어 글자를 선택하면 keyup·mouseup·input이 하나도 안 온다.
  //    그 경우 기억해 둔 커서가 '아까 탭했던 한 점'에 머물러서,
  //    굵게를 눌러도 빈 자리에 서식이 걸릴 뿐 화면에는 아무 일도 안 일어난다.
  //    (폰에서 툴바가 안 먹던 진짜 이유다)
  useEffect(() => {
    if (!open) return;
    document.addEventListener("selectionchange", rememberCaret);
    return () => document.removeEventListener("selectionchange", rememberCaret);
  }, [open, rememberCaret]);

  const restoreCaret = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const sel = window.getSelection();

    // ⚠️ 커서가 이미 편집칸 안에 있으면 선택에 손을 대지 않는다.
    //    removeAllRanges()는 '눌러는 뒀지만 아직 어떤 글자에도 안 붙은 서식'을
    //    같이 날려 버린다. 빈 칸에서 굵게를 켜고 이어서 크게를 누르면
    //    굵게가 조용히 사라지던 것이 이것 때문이었다.
    //    (되돌려 놓는 건 툴바가 커서를 빼앗아 갔을 때만 필요한 일이다)
    if (sel && sel.rangeCount > 0 && body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      body.focus();
      return;
    }

    body.focus();
    const r = savedRange.current;
    // 기억해 둔 자리가 없거나, 그 자리가 지금 편집칸 밖이면 맨 끝에 커서를 놓는다.
    //
    // ⚠️ '밖인지'를 꼭 확인해야 한다. 이 시트는 닫혀도 화면에서 사라지지 않고
    //    null만 그리는 구조라(lib/post-editor-context), 글을 하나 쓰고 나면
    //    savedRange가 '이미 지워진 이전 글의 글자'를 계속 가리킨다.
    //    그걸 그대로 되돌리면 커서가 어디에도 없는 상태가 되어,
    //    새 글에서 서식 버튼이 아무 반응도 안 한다.
    if (!r || !body.contains(r.commonAncestorContainer)) return placeCaretAtEnd(body);
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
      // selectionchange가 안 올 수도 있어(선택 범위가 그대로일 때) 한 번 더 맞춘다
      setMarks(readMarks(bodyRef.current));
    },
    [restoreCaret, rememberCaret]
  );

  /**
   * 커서 자리에 HTML을 끼워 넣는다 — execCommand("insertHTML")을 안 쓴다.
   *
   * ⚠️ 사진이 안 들어가던 이유가 여기였다. 사진첩을 다녀오면 편집칸이 포커스를
   *    잃은 상태라, insertHTML은 "지금 편집 중인 곳"을 못 찾고 조용히 아무 일도
   *    안 한 채 끝난다(예외도 안 난다). 그래서 사진을 골라도 화면에 안 나타났다.
   *    기억해 둔 Range에 DOM으로 직접 꽂으면 포커스와 무관하게 들어간다.
   */
  const insertAtCaret = useCallback((html: string) => {
    const body = bodyRef.current;
    if (!body) return;
    const frag = document.createRange().createContextualFragment(html);
    const last = frag.lastChild;
    const r = savedRange.current;
    if (r && body.contains(r.commonAncestorContainer)) {
      r.deleteContents();
      r.insertNode(frag);
    } else {
      // 커서를 둔 적이 없으면(사진부터 넣는 경우) 글 맨 끝에 붙인다
      body.appendChild(frag);
    }
    // 다음 입력이 사진 뒤로 이어지도록 커서를 옮겨 둔다
    if (last) {
      const next = document.createRange();
      next.setStartAfter(last);
      next.collapse(true);
      savedRange.current = next;
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(next);
    }
  }, []);

  /* ── 링크 ───────────────────────────────────────── */

  function openLinkSheet() {
    // 지금 골라 둔 글자가 있으면 '보일 글자'로 미리 채워 준다
    setLinkText(savedRange.current?.toString() ?? "");
    setLinkUrl("");
    (document.activeElement as HTMLElement | null)?.blur();
    setLinkOpen(true);
  }

  /** false를 돌려주면 시트가 안 닫힌다 (BottomSheet 규칙) */
  function applyLink(): boolean | void {
    const raw = linkUrl.trim();
    if (!raw) {
      alert("링크 주소를 입력해 주세요.");
      return false;
    }
    // 주소창에서 복사하면 https://가 빠져 오는 일이 잦다 — 없으면 붙여 준다
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (!/^https?:\/\/[^\s/]+\.[^\s/]{2,}/i.test(url)) {
      alert("주소를 다시 확인해 주세요. (예: alive.example.com/글)");
      return false;
    }
    // 보일 글자를 안 적었으면 주소를 그대로 보여 준다
    const label = linkText.trim() || url;
    // execCommand("createLink")를 안 쓴다 — 시트를 다녀오면 편집칸이 포커스를
    // 잃어서 조용히 아무 일도 안 하는 경우가 있다 (사진에서 겪었던 것과 같다).
    insertAtCaret(
      `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`
    );
    bodyRef.current?.focus();
    rememberCaret();
    setLinkUrl("");
    setLinkText("");
  }

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
      insertAtCaret(html + "<div><br></div>");
      bodyRef.current?.focus();
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
          void pushToAll({ title: `📢 공지 · ${post.title}`, body: "새 공지가 올라왔어요.", href: `/board/${id}`, tag: "notice" });
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

  // 게시 버튼을 켤 조건. 본문은 contentEditable이라 상태로 안 들고 있어서
  // 여기선 못 본다 — 제목·게시판까지만 미리 보고, 본문 검사는 submit()이 한다.
  const canSubmit = !!board && !!title.trim();

  // '크게'가 켜져 있는가. sizeNow는 커서가 본문 안에 있을 때만 값이 있고,
  // 글자를 치기 전에 눌러 둔 것까지 잡아 준다 (lib/rich-text 참고).
  const largeOn = marks.sizeNow === SIZE_LARGE;

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
        {/* ── 상단 ──
             일정 등록 바텀시트(components/BottomSheet)와 같은 모양이다:
             왼쪽 흰 동그라미 ✕ · 가운데 굵은 제목 · 오른쪽 강조색 동그라미 ✓.
             두 시트가 다르게 생기면 같은 앱에서 규칙이 두 개인 것처럼 보인다.
             ⚠️ 치수를 바꿀 일이 있으면 BottomSheet의 헤더도 같이 볼 것. */}
        <header className="flex shrink-0 items-center gap-2 px-4 py-3">
          <button
            onClick={handleCancel}
            aria-label={kbOpen ? "키보드 내리기" : "닫기"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            {kbOpen ? <KeyboardDownIcon className="h-[22px] w-[22px]" /> : <XIcon className="h-[22px] w-[22px]" />}
          </button>

          {/* 게시판 고르기 — 취소 버튼 바로 옆에, 같은 흰 알약으로.
              누르면 글 설정(게시판·태그·공지)이 열린다. */}
          <button
            onClick={() => {
              (document.activeElement as HTMLElement | null)?.blur();
              setOptionsOpen(true);
            }}
            className="flex h-11 min-w-0 items-center gap-1 rounded-full bg-white px-4 shadow-sm transition hover:bg-slate-50 active:scale-95"
          >
            <span className="truncate text-[15px] font-bold text-slate-900">{board || "게시판 선택"}</span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-500" />
          </button>

          {/* 제목이 비어 있으면 흰 동그라미로 꺼 둔다 — 눌러도 경고창만 뜨던 걸 미리 알려 준다 */}
          <button
            onClick={submit}
            disabled={busy || !canSubmit}
            aria-label={editing ? "수정 완료" : "게시"}
            className={`ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-sm transition active:scale-95 ${
              canSubmit ? "text-accent-fg hover:brightness-110" : "bg-white text-slate-300"
            }`}
            style={canSubmit ? { backgroundColor: "rgb(var(--accent))" } : undefined}
          >
            {busy ? (
              <Spinner className="h-5 w-5" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                <path d="M4 13l5 5L20 7" />
              </svg>
            )}
          </button>
        </header>

        {/* ── 제목 · 본문 · 툴바 — 셋이 한 스크롤 안에 있다 ──
             툴바가 본문 밑에 흐름대로 놓여, 글이 길어지면 같이 내려간다. */}
        <div ref={scrollRef} className="editor-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
            // 제목과 본문 사이를 벌린다 — 붙어 있으면 제목의 첫 줄처럼 읽힌다.
            // 아래 본문의 pt-4와 합쳐 약 24px.
            // 예시 글자는 slate-300이면 화면에서 거의 안 보여 slate-400으로 올렸다.
            className="w-full bg-transparent px-4 pb-2 pt-3 text-[24px] font-bold outline-none placeholder:text-slate-400"
          />

          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            // 줄이 바뀌어도 켜 둔 서식이 풀리지 않게 (엔터 직전 상태를 기억해 뒀다 되살린다)
            // setMarks를 같이 넘겨야 툴바의 켜짐 표시까지 되살아난다 (lib/rich-text 참고)
            onKeyDown={(e) => { if (e.key === "Enter") keepMarksAcrossNewline(bodyRef.current, setMarks); }}
            onKeyUp={() => { rememberCaret(); scrollToCaret(); }}
            onMouseUp={rememberCaret}
            onTouchEnd={rememberCaret}
            onFocus={rememberCaret}
            onClick={handleBodyClick}
            onInput={() => {
              rememberCaret();
              setSelectedImg(null);
              scrollToCaret();
            }}
            data-placeholder="본문 텍스트(선택 사항)"
            style={{ textAlign: align }}
            // 최소 높이는 화면이 아니라 고정값이다 — 툴바가 본문을 따라 내려오므로
            // 빈 글에서 툴바가 화면 밖까지 밀려나면 안 된다.
            className="rich min-h-[168px] w-full px-4 pb-4 pt-4 text-[16px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl"
          />

          {/* ── 툴바 — 본문 바로 밑 ──
               순서: 링크 · 사진 · 투표 │ 굵게 · 기울임 · 밑줄 · 글자크기 · 취소선 · 목록 · 번호목록 · 인용

               레퍼런스처럼 '떠 있는 타원 바' 하나다. 구분선(border-t)으로 칸을 나누지 않는다.
               바 색은 --surface — 캔버스(--bg)보다 한 단계 어두워서, 흰 본문 위에
               얹힌 판으로 읽힌다. 그림자는 테두리처럼 보이지 않게 넓고 옅게만 준다.

               ⚠️ 더보기(⋯)는 없앴다. 항목이 화면을 넘치면 접는 대신 가로로 민다 —
                  접어 두면 어떤 기능이 있는지 자체를 모른다. */}
          <div className="px-3 pb-1 pt-2">
            <div
              className="no-scrollbar flex h-[52px] items-center gap-0.5 overflow-x-auto rounded-full bg-surface px-1.5"
              style={{ boxShadow: "0 2px 10px rgba(16,24,40,0.05), 0 8px 24px -12px rgba(16,24,40,0.08)" }}
            >
              <ToolBtn onPress={openLinkSheet} label="링크">
                <LinkIcon className="h-[20px] w-[20px]" />
              </ToolBtn>

              {/*
               * 사진 — 버튼이 아니라 <label>이다.
               * ⚠️ 사진이 안 열리던 이유: 숨긴 input.click()을 pointerdown에서 부르면
               *    아이폰 사파리가 '사용자가 직접 누른 것'으로 안 쳐서 사진첩이 안 뜬다.
               *    label 안에 input을 넣으면 브라우저가 직접 이어 주므로 그 규칙을 안 탄다.
               *    input도 display:none이면 같은 이유로 막혀서, 보이지 않게만 눌러 뒀다.
               */}
              <label
                aria-label="사진 추가"
                className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl text-slate-600 active:bg-slate-100"
              >
                {imgBusy ? <Spinner className="h-5 w-5" /> : <ImageIcon className="h-[21px] w-[21px]" />}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={(e) => onFiles(e.target.files)}
                />
              </label>

              {/* 투표 — 사진 바로 오른쪽. '넣는 것'끼리 묶여야 손이 헷갈리지 않는다 */}
              <ToolBtn
                onPress={() => {
                  (document.activeElement as HTMLElement | null)?.blur();
                  setPollOpen(true);
                }}
                label="투표"
                active={pollOn}
              >
                <PollIcon className="h-[20px] w-[20px]" />
              </ToolBtn>

              <span className="mx-1 h-5 w-px shrink-0 bg-slate-300/70" />

              <ToolBtn onPress={() => cmd("bold")} label="굵게" active={marks.bold}>
                <span className="text-[16px] font-bold">B</span>
              </ToolBtn>
              <ToolBtn onPress={() => cmd("italic")} label="기울임" active={marks.italic}>
                <span className="font-serif text-[16px] italic">I</span>
              </ToolBtn>
              <ToolBtn onPress={() => cmd("underline")} label="밑줄" active={marks.underline}>
                <span className="text-[16px] underline">U</span>
              </ToolBtn>
              {/* 글자 크기 — 목록을 펼치지 않고 기본↔크게를 오간다 */}
              <ToolBtn
                onPress={() => cmd("fontSize", largeOn ? SIZE_NORMAL : SIZE_LARGE)}
                label={largeOn ? "글자 크기 (지금 크게)" : "글자 크기 (지금 기본)"}
                active={largeOn}
              >
                <TextSizeIcon className="h-[21px] w-[21px]" />
              </ToolBtn>
              {/* 예전엔 여기부터가 '더보기(⋯)' 안에 접혀 있었다.
                  글자크기 오른쪽으로 펼쳐 두고, 넘치면 바를 가로로 민다. */}
              <ToolBtn onPress={() => cmd("strikeThrough")} label="취소선" active={marks.strike}>
                <span className="text-[16px] line-through">S</span>
              </ToolBtn>
              <ToolBtn onPress={() => cmd("insertUnorderedList")} label="목록" active={marks.ul}>
                <ListBulletIcon className="h-[20px] w-[20px]" />
              </ToolBtn>
              <ToolBtn onPress={() => cmd("insertOrderedList")} label="번호 목록" active={marks.ol}>
                <ListOrderedIcon className="h-[20px] w-[20px]" />
              </ToolBtn>
              <ToolBtn onPress={() => cmd("formatBlock", marks.quote ? "div" : "blockquote")} label="인용" active={marks.quote}>
                <QuoteIcon className="h-[20px] w-[20px]" />
              </ToolBtn>
            </div>
          </div>

          {/* 임시저장 — 레퍼런스처럼 툴바 밑 오른쪽. 툴바를 따라 같이 내려간다 */}
          <div className="flex justify-end px-3 py-2.5">
            <button
              onClick={saveDraft}
              className="rounded-full bg-surface px-4 py-2 text-[14px] font-semibold text-slate-600 active:brightness-95"
            >
              임시저장
            </button>
          </div>

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

      {/* ── 링크 ── */}
      <BottomSheet open={linkOpen} title="링크" onClose={() => setLinkOpen(false)} onConfirm={applyLink}>
        <div className="space-y-3">
          <div>
            <p className="label">주소</p>
            <input
              className="input"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="alive.example.com/글"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[12px] text-slate-400">https://는 안 적어도 알아서 붙여요.</p>
          </div>
          <div>
            <p className="label">보일 글자 (선택)</p>
            <input
              className="input"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="비워 두면 주소가 그대로 보여요"
            />
          </div>
        </div>
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

/** 사용자가 친 글자를 HTML 안에 넣기 전에 안전하게 만든다 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
