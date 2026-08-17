"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

  // 초기값만 주입(입력 중 리렌더로 커서가 튀지 않도록 비제어)
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }
  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }
  function addLink() {
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

  const Btn = ({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100"
    >
      {children}
    </button>
  );

  const Dropdown = ({
    open,
    setOpen,
    label,
    icon,
    children,
  }: {
    open: boolean;
    setOpen: (v: boolean) => void;
    label: string;
    icon: ReactNode;
    children: ReactNode;
  }) => (
    <div className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setOpen(!open); if (!open) { setSizeOpen(false); setAlignOpen(false); setOpen(true); } }}
        aria-label={label}
        title={label}
        className="flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-slate-600 transition hover:bg-slate-100"
      >
        {icon}
        <svg className="h-3 w-3" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[100px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {children}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-1">
        <Btn onClick={() => cmd("bold")} label="굵게"><span className="text-[15px] font-bold">B</span></Btn>
        <Btn onClick={() => cmd("italic")} label="기울임"><span className="font-serif text-[15px] italic">I</span></Btn>
        <Btn onClick={() => cmd("underline")} label="밑줄"><span className="text-[15px] underline">U</span></Btn>
        <Btn onClick={() => cmd("strikeThrough")} label="취소선"><span className="text-[15px] line-through">S</span></Btn>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {/* 글자 크기 */}
        <Dropdown open={sizeOpen} setOpen={setSizeOpen} label="글자 크기" icon={<span className="text-xs font-medium">가</span>}>
          {FONT_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { cmd("fontSize", s.value); setSizeOpen(false); }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              {s.label}
            </button>
          ))}
        </Dropdown>
        {/* 정렬 */}
        <Dropdown open={alignOpen} setOpen={setAlignOpen} label="정렬" icon={
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="7" x2="10" y2="7"/><line x1="2" y1="11" x2="14" y2="11"/><line x1="2" y1="15" x2="8" y2="15"/>
          </svg>
        }>
          {ALIGNMENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { cmd(a.value); setAlignOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
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
            </button>
          ))}
        </Dropdown>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <Btn onClick={() => cmd("insertUnorderedList")} label="목록"><ListBulletIcon className="h-4 w-4" /></Btn>
        <Btn onClick={() => cmd("insertOrderedList")} label="번호 목록"><ListOrderedIcon className="h-4 w-4" /></Btn>
        <Btn onClick={() => cmd("formatBlock", "blockquote")} label="인용"><QuoteIcon className="h-4 w-4" /></Btn>
        <Btn onClick={addLink} label="링크"><LinkIcon className="h-4 w-4" /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={() => {
          if (ref.current) onChange(sanitizeRichHtml(ref.current.innerHTML));
        }}
        data-placeholder={placeholder}
        className="rich min-h-[240px] w-full px-3.5 py-2.5 text-[15px] leading-relaxed outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
