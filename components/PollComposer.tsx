"use client";

// 글에 넣을 투표를 만드는 카드.
//
// ⚠️ 편집기가 둘이라(PC=RichEditor, 폰=PostEditorSheet) 이 카드는 반드시 둘이 같이 쓴다.
//    예전엔 바텀시트를 따로 띄웠는데, 글을 쓰다가 창이 덮여 무엇을 만들고 있는지
//    안 보였다. 지금은 본문 바로 아래에 카드로 붙어 있어 결과가 눈에 보인다.
//
// 마감은 '언제까지'가 아니라 '며칠 동안'으로 고른다 —
// 폰에서 달력·시계를 돌리는 것보다 탭 한 번이 빠르고, 투표는 대개 며칠짜리라
// 정확한 시각이 필요한 경우가 드물다. 고르면 지금부터 N일 뒤로 계산해 저장한다.

import { useRef, useState } from "react";
import { XIcon } from "@/components/Icons";

export const MAX_POLL_OPTIONS = 10;
const DAY = 24 * 60 * 60 * 1000;
/** 고를 수 있는 기간 (일). 0 = 마감 없음 */
const DURATIONS = [0, 1, 3, 7];

export type PollDraft = {
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  /** 마감 시각(ms). 0이면 마감 없음 */
  deadline: number;
};

export const EMPTY_POLL: PollDraft = {
  options: ["", ""],
  multiple: false,
  anonymous: false,
  deadline: 0,
};

/** 남은 날짜 — 올림. 이미 지났으면 0 */
function daysLeft(deadline: number): number {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / DAY));
}

/** 여섯 개 점 대신 세로 점 세 개 — 꾹 눌러 끌면 순서가 바뀐다는 표시 */
function GripIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="12" cy="6" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="18" r="1.7" />
    </svg>
  );
}

export default function PollComposer({
  value,
  onChange,
  onRemove,
}: {
  value: PollDraft;
  onChange: (next: PollDraft) => void;
  /** ✕ — 이 글에서 투표를 뺀다 */
  onRemove: () => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  // 지금 끌고 있는 선택지의 자리 (null이면 안 끄는 중)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const drag = useRef<{ startY: number; timer: number | null; idx: number } | null>(null);

  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });
  const setOption = (i: number, v: string) =>
    set({ options: value.options.map((o, j) => (j === i ? v : o)) });

  /* ── 꾹 눌러 순서 바꾸기 ───────────────────────────
     바로 끌리게 하면 목록을 스크롤할 수가 없다. 250ms 눌러야 시작하고,
     그 전에 손이 움직이면 스크롤로 보고 취소한다. */
  function onGripDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const timer = window.setTimeout(() => setDragIdx(i), 250);
    drag.current = { startY: e.clientY, timer, idx: i };
  }

  function onGripMove(e: React.PointerEvent) {
    const s = drag.current;
    if (!s) return;
    if (dragIdx === null) {
      if (Math.abs(e.clientY - s.startY) > 8) {
        if (s.timer) window.clearTimeout(s.timer);
        drag.current = null;
      }
      return;
    }
    const box = rowsRef.current;
    if (!box) return;
    const rows = Array.from(box.querySelectorAll<HTMLElement>("[data-opt]"));
    const over = rows.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (over < 0 || over === s.idx) return;
    const next = [...value.options];
    const [moved] = next.splice(s.idx, 1);
    next.splice(over, 0, moved);
    set({ options: next });
    s.idx = over;
    setDragIdx(over);
  }

  function onGripUp() {
    if (drag.current?.timer) window.clearTimeout(drag.current.timer);
    drag.current = null;
    setDragIdx(null);
  }

  const left = daysLeft(value.deadline);
  // 저장된 마감이 고를 수 있는 값과 안 맞으면(예전 글) 그 값도 목록에 끼워 준다
  const extra = value.deadline && !DURATIONS.includes(left) ? left : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      {/* 머리 — 마감까지 며칠 · 투표 빼기 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[14px] font-semibold text-slate-500">마감까지</span>
        <select
          value={extra !== null ? "x" : String(left)}
          onChange={(e) => {
            const d = Number(e.target.value);
            set({ deadline: d > 0 ? Date.now() + d * DAY : 0 });
          }}
          className="min-w-0 cursor-pointer rounded-lg bg-transparent py-1 text-[15px] font-bold text-slate-900 outline-none"
        >
          {extra !== null && <option value="x">{extra}일</option>}
          <option value="0">마감 없음</option>
          <option value="1">1일</option>
          <option value="3">3일</option>
          <option value="7">7일</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          aria-label="투표 빼기"
          className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-400 text-white transition active:bg-slate-500"
        >
          <XIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* 선택지 */}
      <div ref={rowsRef} className="mt-3 space-y-2">
        {value.options.map((opt, i) => (
          <div key={i} data-opt className="flex items-center gap-2">
            <div
              className={`flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-surface px-2 py-2.5 transition ${
                dragIdx === i ? "scale-[1.02] shadow-md" : ""
              }`}
            >
              <span
                onPointerDown={(e) => onGripDown(e, i)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
                aria-label="꾹 눌러 순서 바꾸기"
                className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center text-slate-400"
              >
                <GripIcon className="h-[18px] w-[18px]" />
              </span>
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`선택지 ${i + 1}`}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            {/* 최소 두 개는 있어야 투표가 되므로 앞의 둘에는 ✕가 없다.
                (앞 둘의 내용을 바꾸고 싶으면 글자만 지우면 된다 —
                 빈 선택지는 저장할 때 알아서 걸러진다) */}
            {i >= 2 && (
              <button
                type="button"
                onClick={() => set({ options: value.options.filter((_, j) => j !== i) })}
                aria-label={`선택지 ${i + 1} 삭제`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition active:bg-slate-100"
              >
                <XIcon className="h-[19px] w-[19px]" />
              </button>
            )}
          </div>
        ))}

        {value.options.length < MAX_POLL_OPTIONS && (
          <button
            type="button"
            onClick={() => set({ options: [...value.options, ""] })}
            className="flex w-full items-center gap-2 rounded-xl bg-surface px-3 py-3 text-[15px] font-medium text-slate-400 transition active:brightness-95"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
              <path d="M12 5v14M5 12h14" />
            </svg>
            선택지 추가
          </button>
        )}
      </div>

      {/* 복수 선택 · 익명 — 레퍼런스 카드엔 없지만 이 앱에는 뜻이 있는 값이라 남긴다.
          특히 익명은 '누가 뭘 골랐는지 명단을 안 연다'는 약속이다 (board/[id] 참고). */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={value.multiple}
            onChange={(e) => set({ multiple: e.target.checked })}
            className="h-4 w-4 accent-[rgb(var(--accent))]"
          />
          복수 선택
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={value.anonymous}
            onChange={(e) => set({ anonymous: e.target.checked })}
            className="h-4 w-4 accent-[rgb(var(--accent))]"
          />
          익명 (명단 비공개)
        </label>
      </div>
    </div>
  );
}
