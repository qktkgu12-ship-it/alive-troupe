"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { LinkIcon, ListBulletIcon, ListOrderedIcon, QuoteIcon } from "@/components/Icons";

const FONT_SIZES: { label: string; value: string }[] = [
  { label: "작게", value: "2" },
  { label: "보통", value: "3" },
  { label: "크게", value: "4" },
  { label: "아주 크게", value: "5" },
];

const ALIGNMENTS: { label: string; value: string; icon: string }[] = [
  { label: "왼쪽", value: "justifyLeft", icon: "≡" },
  { label: "가운데", value: "justifyCenter", icon: "≡" },
  { label: "오른쪽", value: "justifyRight", icon: "≡" },
];

// 커서 자리에 걸려 있는 서식. 툴바 버튼을 켜고 끄는 데만 쓴다.
type Marks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ul: boolean;
  ol: boolean;
  quote: boolean;
  align: string;
  size: string;
};
const NO_MARKS: Marks = {
  bold: false, italic: false, underline: false, strike: false,
  ul: false, ol: false, quote: false, align: "justifyLeft", size: "3",
};

// ⚠️ Btn·Dropdown은 반드시 컴포넌트 '밖'에 있어야 한다.
//    안에 두면 글자를 칠 때마다 새 컴포넌트로 취급돼 툴바가 통째로 다시 그려지고,
//    그 순간 누르고 있던 버튼이 사라져 탭이 먹히지 않는다.
//    (폰에서 툴바가 아예 동작하지 않던 원인 중 하나였다)

// 켜져 있는 버튼은 강조색 알약으로 바뀐다.
// 굵게/기울임처럼 '지금 상태'가 있는 기능은, 눌러서 켠 건지 원래 켜져 있던 건지
// 표시가 없으면 글을 쓰다가 알 수가 없다.
const ON = "bg-accent/10 text-accent";
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
  return (
    <button
      type="button"
      // pointerdown으로 막아야 한다. mousedown은 폰에서 손을 뗀 뒤에야 오므로
      // 그때는 이미 편집칸의 포커스와 선택 영역이 날아간 뒤다.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
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
  return (
    <div className="relative">
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
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
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
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

  // 커서가 <font size="n"> 안에 있으면 그 n. 크기를 지정한 적 없으면 빈 문자열.
  const explicitSize = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    while (n && n !== ref.current) {
      if (n instanceof HTMLElement && n.tagName === "FONT") {
        const s = n.getAttribute("size");
        if (s) return s;
      }
      n = n.parentNode;
    }
    return "";
  }, []);

  const syncMarks = useCallback(() => {
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    const v = (c: string) => {
      try {
        return String(document.queryCommandValue(c) ?? "");
      } catch {
        return "";
      }
    };
    setOn({
      bold: q("bold"),
      italic: q("italic"),
      underline: q("underline"),
      strike: q("strikeThrough"),
      ul: q("insertUnorderedList"),
      ol: q("insertOrderedList"),
      // formatBlock은 대소문자가 브라우저마다 다르다 (blockquote / BLOCKQUOTE)
      quote: v("formatBlock").toLowerCase() === "blockquote",
      align: q("justifyCenter") ? "justifyCenter" : q("justifyRight") ? "justifyRight" : "justifyLeft",
      // 크기는 queryCommandValue를 믿지 않는다.
      // 그 값은 '지금 글자가 몇 픽셀인가'를 1~7로 환산해 주는 거라,
      // 크기를 한 번도 안 건드린 글자도 편집칸 기본 글씨 크기에 따라
      // 2가 나오기도 3이 나오기도 한다 → 툴바가 늘 켜져 있게 된다.
      // 대신 execCommand가 실제로 만들어 넣는 <font size="n">를 직접 찾는다.
      size: explicitSize() || "3",
    });
  }, [explicitSize]);

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
    if (!r) return;
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

  const [sizeOpen, setSizeOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-1">
        <Btn onPress={() => cmd("bold")} label="굵게" active={on.bold}><span className="text-[15px] font-bold">B</span></Btn>
        <Btn onPress={() => cmd("italic")} label="기울임" active={on.italic}><span className="font-serif text-[15px] italic">I</span></Btn>
        <Btn onPress={() => cmd("underline")} label="밑줄" active={on.underline}><span className="text-[15px] underline">U</span></Btn>
        <Btn onPress={() => cmd("strikeThrough")} label="취소선" active={on.strike}><span className="text-[15px] line-through">S</span></Btn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {/* 글자 크기 — 크기를 지정했을 때만 그 이름을 옆에 띄운다.
            늘 띄우면 툴바가 넓어져 폰에서 한 줄이 더 접히는데,
            '보통'은 어차피 기본값이라 굳이 알려 줄 게 없다. */}
        <Dropdown
          open={sizeOpen}
          onToggle={() => { setAlignOpen(false); setSizeOpen((v) => !v); }}
          onClose={() => setSizeOpen(false)}
          label="글자 크기"
          active={on.size !== "3"}
          icon={
            <span className="flex items-center gap-1">
              <span className="text-xs font-medium">가</span>
              {on.size !== "3" && (
                <span className="text-[11px] font-semibold">
                  {FONT_SIZES.find((s) => s.value === on.size)?.label ?? ""}
                </span>
              )}
            </span>
          }
        >
          {FONT_SIZES.map((s) => (
            <MenuItem
              key={s.value}
              active={on.size === s.value}
              onPress={() => { cmd("fontSize", s.value); setSizeOpen(false); }}
            >
              {s.label}
            </MenuItem>
          ))}
        </Dropdown>
        {/* 정렬 */}
        <Dropdown
          open={alignOpen}
          onToggle={() => { setSizeOpen(false); setAlignOpen((v) => !v); }}
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
        {/* 링크는 '상태'가 아니라 '한 번 하는 일'이라 켜짐 표시가 없다 */}
        <Btn onPress={addLink} label="링크"><LinkIcon className="h-4 w-4" /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { remember(); emit(); }}
        onKeyUp={remember}
        onMouseUp={remember}
        onTouchEnd={remember}
        onFocus={syncMarks}
        onBlur={() => {
          // 편집칸을 떠나면 툴바도 꺼진 상태로 되돌린다 —
          // 다른 곳을 보고 있는데 굵게 버튼만 켜져 있으면 무엇에 걸린 표시인지 알 수 없다
          setOn(NO_MARKS);
          if (ref.current) onChange(sanitizeRichHtml(ref.current.innerHTML));
        }}
        data-placeholder={placeholder}
        className="rich min-h-[240px] w-full px-3.5 py-2.5 text-[15px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
