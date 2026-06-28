"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { LinkIcon, ListBulletIcon, ListOrderedIcon, QuoteIcon } from "@/components/Icons";

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

  const Btn = ({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // 선택 영역 유지
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100"
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border border-slate-200 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-1">
        <Btn onClick={() => cmd("bold")} label="굵게"><span className="text-[15px] font-bold">B</span></Btn>
        <Btn onClick={() => cmd("italic")} label="기울임"><span className="font-serif text-[15px] italic">I</span></Btn>
        <Btn onClick={() => cmd("underline")} label="밑줄"><span className="text-[15px] underline">U</span></Btn>
        <Btn onClick={() => cmd("strikeThrough")} label="취소선"><span className="text-[15px] line-through">S</span></Btn>
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
