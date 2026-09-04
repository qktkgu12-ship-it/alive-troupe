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

// ⚠️ Btn·Dropdown은 반드시 컴포넌트 '밖'에 있어야 한다.
//    안에 두면 글자를 칠 때마다 새 컴포넌트로 취급돼 툴바가 통째로 다시 그려지고,
//    그 순간 누르고 있던 버튼이 사라져 탭이 먹히지 않는다.
//    (폰에서 툴바가 아예 동작하지 않던 원인 중 하나였다)

function Btn({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
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
      title={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 active:bg-slate-200"
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
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  label: string;
  icon: ReactNode;
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
        title={label}
        className="flex h-9 items-center gap-0.5 rounded-lg px-2 text-slate-600 transition hover:bg-slate-100 active:bg-slate-200"
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

function MenuItem({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100"
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

  const remember = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    // 편집칸 밖(툴바·주소창 등)의 선택은 기억하지 않는다
    if (ref.current?.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
  }, []);

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
        <Btn onPress={() => cmd("bold")} label="굵게"><span className="text-[15px] font-bold">B</span></Btn>
        <Btn onPress={() => cmd("italic")} label="기울임"><span className="font-serif text-[15px] italic">I</span></Btn>
        <Btn onPress={() => cmd("underline")} label="밑줄"><span className="text-[15px] underline">U</span></Btn>
        <Btn onPress={() => cmd("strikeThrough")} label="취소선"><span className="text-[15px] line-through">S</span></Btn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {/* 글자 크기 */}
        <Dropdown
          open={sizeOpen}
          onToggle={() => { setAlignOpen(false); setSizeOpen((v) => !v); }}
          onClose={() => setSizeOpen(false)}
          label="글자 크기"
          icon={<span className="text-xs font-medium">가</span>}
        >
          {FONT_SIZES.map((s) => (
            <MenuItem key={s.value} onPress={() => { cmd("fontSize", s.value); setSizeOpen(false); }}>
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
          icon={
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="7" x2="10" y2="7"/><line x1="2" y1="11" x2="14" y2="11"/><line x1="2" y1="15" x2="8" y2="15"/>
            </svg>
          }
        >
          {ALIGNMENTS.map((a) => (
            <MenuItem key={a.value} onPress={() => { cmd(a.value); setAlignOpen(false); }}>
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
        <Btn onPress={() => cmd("insertUnorderedList")} label="목록"><ListBulletIcon className="h-4 w-4" /></Btn>
        <Btn onPress={() => cmd("insertOrderedList")} label="번호 목록"><ListOrderedIcon className="h-4 w-4" /></Btn>
        <Btn onPress={() => cmd("formatBlock", "blockquote")} label="인용"><QuoteIcon className="h-4 w-4" /></Btn>
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
        onBlur={() => {
          if (ref.current) onChange(sanitizeRichHtml(ref.current.innerHTML));
        }}
        data-placeholder={placeholder}
        className="rich min-h-[240px] w-full px-3.5 py-2.5 text-[15px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
