"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { LinkIcon, ListBulletIcon, ListOrderedIcon, QuoteIcon, TextSizeIcon } from "@/components/Icons";
// ⚠️ 글쓰기 편집기는 둘이다 — PC는 이 파일, 폰은 components/PostEditorSheet.
//    공통 로직은 아래 두 곳에 두고 둘이 같이 쓴다. 한쪽만 고치면 폰이 그대로 남는다.
import { NO_MARKS, keepMarksAcrossNewline, placeCaretAtEnd, readMarks, type Marks } from "@/lib/rich-text";
import { usePress } from "@/lib/use-press";

// 글자 크기는 두 단계뿐 — 기본과 크게. 폰 편집기와 같은 값이어야 한다.
// execCommand("fontSize")가 쓰는 1~7 척도로, 3 = 편집칸 기본, 5 = 확실히 큰 글자.
const SIZE_NORMAL = "3";
const SIZE_LARGE = "5";

const ALIGNMENTS: { label: string; value: string; icon: string }[] = [
  { label: "왼쪽", value: "justifyLeft", icon: "≡" },
  { label: "가운데", value: "justifyCenter", icon: "≡" },
  { label: "오른쪽", value: "justifyRight", icon: "≡" },
];

// ⚠️ Btn·Dropdown은 반드시 컴포넌트 '밖'에 있어야 한다.
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

function Dropdown({
  open,
  onToggle,
  onClose,
  label,
  icon,
  active = false,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  label: string;
  icon: ReactNode;
  /** 기본값이 아닌 값이 걸려 있는가 (기본값까지 켜 두면 늘 켜져 있어 의미가 없다) */
  active?: boolean;
  children: ReactNode;
}) {
  const press = usePress(onToggle);
  return (
    <div className="relative">
      <button
        type="button"
        {...press}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`flex h-9 items-center gap-0.5 rounded-lg px-2 transition ${
          active || open ? ON : OFF
        }`}
      >
        {icon}
        <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onPointerDown={onClose} />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[110px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  onPress,
  active = false,
  children,
}: {
  onPress: () => void;
  /** 지금 걸려 있는 값 — 오른쪽에 체크가 붙는다 */
  active?: boolean;
  children: ReactNode;
}) {
  const press = usePress(onPress);
  return (
    <button
      type="button"
      {...press}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 active:bg-slate-100 ${
        active ? "font-semibold text-accent" : "text-slate-700"
      }`}
    >
      {children}
      {active && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="ml-auto h-3.5 w-3.5 shrink-0">
          <polyline points="4 12.5 9.5 18 20 6.5" />
        </svg>
      )}
    </button>
  );
}

// 가벼운 WYSIWYG 에디터 (contentEditable + execCommand). 저장 시 sanitizeRichHtml로 정화.
export default function RichEditor({
  value,
  onChange,
  placeholder = "내용을 입력하세요",
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 마지막으로 편집칸 안에 있던 선택 영역.
  //
  // 툴바 버튼을 누르는 순간 브라우저는 선택을 지운다. 데스크톱은 mousedown을
  // 막으면 지켜지지만, 폰은 손을 대는 순간(pointerdown) 이미 선택이 풀린다.
  // 그래서 '어디를 골라 뒀는지'를 따로 기억해 두었다가 명령 직전에 되돌린다.
  const savedRange = useRef<Range | null>(null);

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

  function restore() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const r = savedRange.current;
    // 기억해 둔 자리가 없으면(= 아직 한 글자도 안 썼거나 커서를 둔 적이 없으면)
    // 맨 끝에 커서를 놓는다. 그래야 바로 서식부터 켜도 그대로 먹힌다.
    if (!r) return placeCaretAtEnd(el);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function cmd(command: string, arg?: string) {
    restore(); // ← 이 한 줄이 폰에서 툴바가 먹히게 하는 핵심
    document.execCommand(command, false, arg);
    remember();
    // selectionchange가 안 올 수도 있어(선택 범위가 그대로일 때) 한 번 더 맞춘다 —
    // 안 그러면 굵게를 눌러도 버튼이 안 켜진다
    syncMarks();
    emit();
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

  const [alignOpen, setAlignOpen] = useState(false);

  // '크게'가 켜져 있는가. sizeNow는 커서가 편집칸 안에 있을 때만 값이 있고,
  // 글자를 치기 전에 눌러 둔 것까지 잡아 준다 (lib/rich-text 참고).
  const largeOn = on.sizeNow === SIZE_LARGE;

  return (
    <div className="rounded-xl border border-slate-200 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-1">
        {/* 폰 편집기(PostEditorSheet)와 같은 순서다 —
            링크 │ 굵게 · 기울임 · 밑줄 · 취소선 · 글자크기 · 정렬 │ 목록 · 번호목록 · 인용
            두 편집기가 다른 순서를 갖고 있으면 기기를 바꿀 때마다 손이 헷갈린다. */}
        {/* 링크는 '상태'가 아니라 '한 번 하는 일'이라 켜짐 표시가 없다 */}
        <Btn onPress={addLink} label="링크"><LinkIcon className="h-4 w-4" /></Btn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn onPress={() => cmd("bold")} label="굵게" active={on.bold}><span className="text-[15px] font-bold">B</span></Btn>
        <Btn onPress={() => cmd("italic")} label="기울임" active={on.italic}><span className="font-serif text-[15px] italic">I</span></Btn>
        <Btn onPress={() => cmd("underline")} label="밑줄" active={on.underline}><span className="text-[15px] underline">U</span></Btn>
        <Btn onPress={() => cmd("strikeThrough")} label="취소선" active={on.strike}><span className="text-[15px] line-through">S</span></Btn>
        {/* 글자 크기 — 목록을 펼치지 않고 기본↔크게만 오간다.
            네 단계 목록은 좁은 화면에서 툴바를 가렸고 '작게'·'아주 크게'는 거의 안 쓰였다. */}
        <Btn
          onPress={() => cmd("fontSize", largeOn ? SIZE_NORMAL : SIZE_LARGE)}
          label={largeOn ? "글자 크기 (지금 크게)" : "글자 크기 (지금 기본)"}
          active={largeOn}
        >
          <TextSizeIcon className="h-4 w-4" />
        </Btn>
        {/* 정렬 */}
        <Dropdown
          open={alignOpen}
          onToggle={() => setAlignOpen((v) => !v)}
          onClose={() => setAlignOpen(false)}
          label="정렬"
          // 왼쪽 정렬은 기본값이라 켜 두지 않는다 — 늘 켜져 있으면 표시가 아니다
          active={on.align !== "justifyLeft"}
          icon={
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="7" x2="10" y2="7"/><line x1="2" y1="11" x2="14" y2="11"/><line x1="2" y1="15" x2="8" y2="15"/>
            </svg>
          }
        >
          {ALIGNMENTS.map((a) => (
            <MenuItem
              key={a.value}
              active={on.align === a.value}
              onPress={() => { cmd(a.value); setAlignOpen(false); }}
            >
              {a.value === "justifyLeft" && (
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="1" y1="2" x2="13" y2="2"/><line x1="1" y1="6" x2="9" y2="6"/><line x1="1" y1="10" x2="13" y2="10"/></svg>
              )}
              {a.value === "justifyCenter" && (
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="1" y1="2" x2="13" y2="2"/><line x1="3" y1="6" x2="11" y2="6"/><line x1="1" y1="10" x2="13" y2="10"/></svg>
              )}
              {a.value === "justifyRight" && (
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="1" y1="2" x2="13" y2="2"/><line x1="5" y1="6" x2="13" y2="6"/><line x1="1" y1="10" x2="13" y2="10"/></svg>
              )}
              {a.label}
            </MenuItem>
          ))}
        </Dropdown>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn onPress={() => cmd("insertUnorderedList")} label="목록" active={on.ul}><ListBulletIcon className="h-4 w-4" /></Btn>
        <Btn onPress={() => cmd("insertOrderedList")} label="번호 목록" active={on.ol}><ListOrderedIcon className="h-4 w-4" /></Btn>
        {/* 인용은 한 번 더 누르면 풀리게 — 켜졌다는 표시만 있고 끌 방법이 없으면 갇힌다 */}
        <Btn
          onPress={() => cmd("formatBlock", on.quote ? "div" : "blockquote")}
          label="인용"
          active={on.quote}
        >
          <QuoteIcon className="h-4 w-4" />
        </Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { remember(); emit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") keepMarksAcrossNewline(ref.current); }}
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
        className="rich min-h-[240px] w-full px-3.5 py-2.5 text-[15px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
