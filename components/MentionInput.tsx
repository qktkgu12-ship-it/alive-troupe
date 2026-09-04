"use client";

// @를 치면 단원 목록이 뜨는 한 줄 입력칸 — 댓글·답글이 같이 쓴다.
//
// 겉모습은 기존 .input과 똑같다. 달라지는 건 @를 쳤을 때 위로 뜨는 목록뿐이라
// 쓰던 사람이 새로 배울 게 없다.

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { activeMentionQuery, type MentionMember } from "@/lib/mentions";

const MAX_SHOWN = 5;

export default function MentionInput({
  value,
  onChange,
  onSubmit,
  members,
  placeholder,
  autoFocus,
  className = "input flex-1",
}: {
  value: string;
  onChange: (v: string) => void;
  /** Enter로 등록 (목록이 열려 있을 때는 목록에서 고르는 게 우선) */
  onSubmit: () => void;
  members: MentionMember[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  // 고르고 난 직후에는 목록을 닫아 둔다.
  // 안 그러면 "@김민수 "를 넣은 순간 다시 "김민수"로 검색해 목록이 또 뜬다.
  const [closed, setClosed] = useState(false);

  const hit = useMemo(() => (closed ? null : activeMentionQuery(value, caret)), [value, caret, closed]);

  const matches = useMemo(() => {
    if (!hit) return [];
    const q = hit.query.toLowerCase();
    const list = members.filter((m) => m.name?.trim());
    // @만 치면 전체 명단, 글자를 치면 그 글자로 시작하는 사람을 먼저 보여 준다
    if (!q) return list.slice(0, MAX_SHOWN);
    const starts = list.filter((m) => m.name.toLowerCase().startsWith(q));
    const rest = list.filter((m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q));
    return [...starts, ...rest].slice(0, MAX_SHOWN);
  }, [hit, members]);

  const open = !!hit && matches.length > 0;

  // 후보가 바뀌면 고른 자리를 처음으로 되돌린다
  useEffect(() => setPicked(0), [hit?.query, hit?.at]);

  function syncCaret() {
    setCaret(ref.current?.selectionStart ?? 0);
  }

  function pick(m: MentionMember) {
    if (!hit) return;
    // "@김" → "@김민수 " 로 바꿔 넣고 커서를 그 뒤로 옮긴다
    const before = value.slice(0, hit.at);
    const after = value.slice(hit.at + 1 + hit.query.length);
    const inserted = `@${m.name} `;
    const next = before + inserted + after;
    const pos = before.length + inserted.length;
    setClosed(true);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  return (
    <div className="relative flex-1">
      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 */}
          <div className="fixed inset-0 z-10" onPointerDown={() => setClosed(true)} />
          {/* 입력칸 '위'로 띄운다 — 댓글칸은 화면 아래쪽에 있어서
              밑으로 열면 키보드에 가린다 */}
          <ul className="absolute bottom-full left-0 z-20 mb-1.5 max-h-[220px] w-full min-w-[200px] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {matches.map((m, i) => (
              <li key={m.uid}>
                <button
                  type="button"
                  // 눌러도 입력칸의 커서를 뺏기지 않게 (뺏기면 넣을 자리를 잃는다)
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                  onMouseEnter={() => setPicked(i)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                    i === picked ? "bg-slate-50" : ""
                  }`}
                >
                  <Avatar src={m.avatar} name={m.name} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <input
        ref={ref}
        className={className}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setClosed(false);
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onBlur={() => setClosed(true)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPicked((p) => (p + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPicked((p) => (p - 1 + matches.length) % matches.length);
              return;
            }
            // 목록이 열려 있으면 Enter는 '고르기'다. 여기서 글이 등록되면
            // 이름을 다 치지도 않았는데 댓글이 올라간다.
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[picked]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setClosed(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
