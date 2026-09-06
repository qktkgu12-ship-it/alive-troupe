"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { compressImage } from "@/components/ImagePicker";
import Spinner from "@/components/Spinner";
import { MAX_IMAGES, usedMediaIds, type MediaMap } from "@/lib/post-media";
import { ImageIcon, LinkIcon, ListBulletIcon, ListOrderedIcon, PollIcon, QuoteIcon, TextSizeIcon } from "@/components/Icons";
// ⚠️ 글쓰기 편집기는 둘이다 — PC는 이 파일, 폰은 components/PostEditorSheet.
//    공통 로직은 아래 두 곳에 두고 둘이 같이 쓴다. 한쪽만 고치면 폰이 그대로 남는다.
import {
  NO_MARKS,
  SIZE_LARGE,
  SIZE_NORMAL,
  applyMark,
  clearMarks,
  insertHtmlAtCaret,
  keepMarksAcrossNewline,
  placeCaretAtEnd,
  readMarks,
  type Marks,
} from "@/lib/rich-text";
import { usePress } from "@/lib/use-press";

// ⚠️ Btn은 반드시 컴포넌트 '밖'에 있어야 한다.
//    안에 두면 글자를 칠 때마다 새 컴포넌트로 취급돼 툴바가 통째로 다시 그려지고,
//    그 순간 누르고 있던 버튼이 사라져 탭이 먹히지 않는다.

// 켜져 있는 버튼은 강조색 알약으로 바뀐다.
// 굵게/기울임처럼 '지금 상태'가 있는 기능은, 눌러서 켠 건지 원래 켜져 있던 건지
// 표시가 없으면 글을 쓰다가 알 수가 없다.
const ON = "text-accent";
const OFF = "text-slate-600 hover:bg-slate-100 active:bg-slate-200";

function Btn({
  onPress,
  label,
  active = false,
  children,
}: {
  onPress: () => void;
  label: string;
  /** 지금 커서 자리에 이 서식이 걸려 있는가 */
  active?: boolean;
  children: ReactNode;
}) {
  const press = usePress(onPress);
  return (
    <button
      type="button"
      {...press}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-lg transition ${active ? ON : OFF}`}
    >
      {children}
    </button>
  );
}

// 가벼운 WYSIWYG 에디터 (contentEditable + execCommand). 저장 시 sanitizeRichHtml로 정화.
export default function RichEditor({
  value,
  onChange,
  placeholder = "내용을 입력하세요",
  media,
  onMedia,
  pollOn,
  onTogglePoll,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /**
   * 본문에 글자처럼 끼워 넣은 사진 (사진id → data URL).
   * 주면 툴바에 사진 버튼이 생긴다 — 폰 편집기와 같은 자리, 같은 방식이다.
   * 예전엔 편집기 밖에 갤러리(ImagePicker)가 따로 있어서 사진이 글 끝에만 붙었다.
   */
  media?: MediaMap;
  onMedia?: (next: MediaMap) => void;
  /** 주면 툴바에 투표 버튼이 생긴다 (카드는 부모가 편집기 아래에 그린다) */
  pollOn?: boolean;
  onTogglePoll?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [imgBusy, setImgBusy] = useState(false);
  // 마지막으로 편집칸 안에 있던 선택 영역.
  //
  // 툴바 버튼을 누르는 순간 브라우저는 선택을 지운다. 데스크톱은 mousedown을
  // 막으면 지켜지지만, 폰은 손을 대는 순간(pointerdown) 이미 선택이 풀린다.
  // 그래서 '어디를 골라 뒀는지'를 따로 기억해 두었다가 명령 직전에 되돌린다.
  const savedRange = useRef<Range | null>(null);
  // 엔터를 연달아 몇 번 쳤는가. 두 번째부터는 '빈 줄'이 생긴 것이라 서식을 푼다.
  const enterRun = useRef(0);

  // 초기값만 주입(입력 중 리렌더로 커서가 튀지 않도록 비제어)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 지금 커서 자리에 어떤 서식이 걸려 있는지 — 툴바를 켜고 끄는 데 쓴다
  const [on, setOn] = useState<Marks>(NO_MARKS);

  // 커서가 어떤 서식 안에 있는지 읽는 일은 lib/rich-text가 한다 (폰 편집기와 같은 코드).
  const syncMarks = useCallback(() => setOn(readMarks(ref.current)), []);

  const remember = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    // 편집칸 밖(툴바·주소창 등)의 선택은 기억하지 않는다.
    // 서식 상태도 마찬가지 — 다른 곳을 클릭했다고 툴바가 꺼지면 안 된다.
    if (!ref.current?.contains(r.commonAncestorContainer)) return;
    savedRange.current = r.cloneRange();
    syncMarks();
  }, [syncMarks]);

  useEffect(() => {
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, [remember]);

  /**
   * 줄바꿈 규칙 (폰 편집기와 같다)
   *   엔터 한 번 → 켜 둔 서식을 다음 줄로 가져간다
   *   엔터 두 번 → 빈 줄이 생긴 것 = 문단이 끝난 것 → 서식을 전부 푼다
   *
   * keydown이 아니라 beforeinput을 듣는다 — 한글을 치는 중에는 keydown의 key가
   * "Process"로 와서 엔터인지 알 수가 없다.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: Event) => {
      const type = (e as InputEvent).inputType || "";
      if (type === "insertParagraph" || type === "insertLineBreak") {
        if (enterRun.current >= 1) clearMarks(el, setOn);
        else keepMarksAcrossNewline(el, setOn);
        enterRun.current += 1;
        return;
      }
      if (type.startsWith("insert") || type.startsWith("delete")) enterRun.current = 0;
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  function restore() {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    // ⚠️ 커서가 이미 편집칸 안이면 선택에 손대지 않는다.
    //    removeAllRanges()는 '아직 어떤 글자에도 안 붙은 서식'을 같이 날린다.
    //    (폰 편집기의 restoreCaret과 같은 규칙)
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      el.focus();
      return;
    }
    el.focus();
    const r = savedRange.current;
    // 기억해 둔 자리가 없거나 지금 편집칸 밖이면 맨 끝에 커서를 놓는다.
    // 그래야 바로 서식부터 켜도 그대로 먹힌다.
    if (!r || !el.contains(r.commonAncestorContainer)) return placeCaretAtEnd(el);
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  // 줄 단위 명령 (목록·인용·정렬·링크)
  function cmd(command: string, arg?: string) {
    restore(); // ← 이 한 줄이 폰에서 툴바가 먹히게 하는 핵심
    document.execCommand(command, false, arg);
    remember();
    // selectionchange가 안 올 수도 있어(선택 범위가 그대로일 때) 한 번 더 맞춘다 —
    // 안 그러면 굵게를 눌러도 버튼이 안 켜진다
    syncMarks();
    emit();
  }

  // 글자 서식 — 아직 아무 글자도 없어도 진짜 태그를 만들어 준다 (lib/rich-text)
  function mark(command: string, arg?: string) {
    restore();
    applyMark(ref.current, command, arg);
    remember();
    syncMarks();
    emit();
    enterRun.current = 0;
  }

  function addLink() {
    // prompt를 띄우면 편집칸의 포커스가 날아가지만,
    // 선택 영역은 이미 savedRange에 있으므로 cmd가 되돌려 놓는다.
    const url = prompt("링크 주소(https://...)를 입력하세요");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      alert("http(s) 주소만 넣을 수 있어요.");
      return;
    }
    cmd("createLink", url);
  }

  /* ── 사진 — 폰 편집기와 같은 방식으로 본문 안에 끼워 넣는다 ────────── */
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || !onMedia) return;
    const used = usedMediaIds(ref.current?.innerHTML || "").length;
    const room = MAX_IMAGES - used;
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
      onMedia({ ...(media ?? {}), ...next });
      const r = insertHtmlAtCaret(ref.current, savedRange.current, html + "<div><br></div>");
      if (r) savedRange.current = r;
      ref.current?.focus();
      remember();
      emit();
    } catch {
      alert("사진을 불러오지 못했어요. 다른 사진으로 시도해 주세요.");
    } finally {
      setImgBusy(false);
    }
  }

  // '크게'가 켜져 있는가. sizeNow는 커서가 편집칸 안에 있을 때만 값이 있고,
  // 글자를 치기 전에 눌러 둔 것까지 잡아 준다 (lib/rich-text 참고).
  const largeOn = on.sizeNow === SIZE_LARGE;

  return (
    <div className="rounded-xl border border-slate-200 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-1">
        {/* 폰 편집기(PostEditorSheet)와 같은 순서다 —
            링크 · 사진 · 투표 │ 굵게 · 기울임 · 밑줄 · 글자크기 · 취소선 · 목록 · 번호목록 · 인용
            두 편집기가 다른 순서를 갖고 있으면 기기를 바꿀 때마다 손이 헷갈린다. */}
        {/* 링크는 '상태'가 아니라 '한 번 하는 일'이라 켜짐 표시가 없다 */}
        <Btn onPress={addLink} label="링크"><LinkIcon className="h-[18px] w-[18px]" /></Btn>

        {/* 사진 — 폰과 같은 이유로 <label>이다. 숨긴 input을 JS로 여는 방식은
            브라우저에 따라 막히므로 label 안에 넣어 브라우저가 직접 잇게 한다. */}
        {onMedia && (
          <label
            aria-label="사진 추가"
            title="사진 추가"
            className="relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg text-slate-600 transition hover:bg-slate-100"
          >
            {imgBusy ? <Spinner className="h-4 w-4" /> : <ImageIcon className="h-[18px] w-[18px]" />}
            <input
              type="file"
              accept="image/*"
              multiple
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
            />
          </label>
        )}

        {onTogglePoll && (
          <Btn onPress={onTogglePoll} label={pollOn ? "투표 빼기" : "투표 넣기"} active={!!pollOn}>
            <PollIcon className="h-[18px] w-[18px]" />
          </Btn>
        )}

        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn onPress={() => mark("bold")} label="굵게" active={on.bold}><span className="text-[16px] font-bold">B</span></Btn>
        <Btn onPress={() => mark("italic")} label="기울임" active={on.italic}><span className="font-serif text-[16px] italic">I</span></Btn>
        <Btn onPress={() => mark("underline")} label="밑줄" active={on.underline}><span className="text-[16px] underline">U</span></Btn>
        {/* 글자 크기 — 목록을 펼치지 않고 기본↔크게만 오간다.
            네 단계 목록은 좁은 화면에서 툴바를 가렸고 '작게'·'아주 크게'는 거의 안 쓰였다. */}
        <Btn
          onPress={() => mark("fontSize", largeOn ? SIZE_NORMAL : SIZE_LARGE)}
          label={largeOn ? "글자 크기 (지금 크게)" : "글자 크기 (지금 기본)"}
          active={largeOn}
        >
          <TextSizeIcon className="h-[18px] w-[18px]" />
        </Btn>
        {/* 정렬은 없앴다 — 거의 안 쓰였고 툴바 자리만 차지했다.
            이미 정렬해 둔 옛 글은 그대로 보인다 (읽기 쪽은 손대지 않았다). */}
        <Btn onPress={() => mark("strikeThrough")} label="취소선" active={on.strike}><span className="text-[16px] line-through">S</span></Btn>
        <Btn onPress={() => cmd("insertUnorderedList")} label="목록" active={on.ul}><ListBulletIcon className="h-[18px] w-[18px]" /></Btn>
        <Btn onPress={() => cmd("insertOrderedList")} label="번호 목록" active={on.ol}><ListOrderedIcon className="h-[18px] w-[18px]" /></Btn>
        {/* 인용은 한 번 더 누르면 풀리게 — 켜졌다는 표시만 있고 끌 방법이 없으면 갇힌다 */}
        <Btn
          onPress={() => cmd("formatBlock", on.quote ? "div" : "blockquote")}
          label="인용"
          active={on.quote}
        >
          <QuoteIcon className="h-[18px] w-[18px]" />
        </Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { remember(); emit(); }}
        // setOn을 같이 넘겨야 툴바의 켜짐 표시까지 되살아난다 (lib/rich-text 참고)
        onKeyUp={remember}
        onMouseUp={remember}
        onTouchEnd={remember}
        onFocus={syncMarks}
        // ⚠️ 여기서 툴바를 끄지 않는다.
        //    폰에서는 툴바를 누르는 순간 편집칸이 잠깐 blur되는 기기가 있어서,
        //    끄게 두면 버튼을 누르자마자 표시가 도로 꺼진다.
        //    게다가 이 에디터는 '마지막 커서 자리'를 기억해 뒀다 그 자리에 명령을
        //    거는 방식이라, 그 자리의 서식을 계속 보여 주는 쪽이 사실에 맞다.
        onBlur={() => {
          if (ref.current) onChange(sanitizeRichHtml(ref.current.innerHTML));
        }}
        data-placeholder={placeholder}
        className="rich min-h-[240px] w-full px-3.5 py-2.5 text-[15px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl"
      />
    </div>
  );
}
