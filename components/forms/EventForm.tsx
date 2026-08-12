"use client";

// 확정 일정 등록 폼 (일정 페이지 + 조율 확정 + 전역 바텀시트 공용)

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";

export type SavedEvent = { date: string; startTime: string; endTime: string; title: string; team: string };

export default function EventForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: { date: string; startTime: string; endTime: string; title?: string; team?: string };
  onSaved: (saved: SavedEvent) => void;
  onCancel: () => void;
}) {
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const [title, setTitle] = useState(initial.title ?? "");
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState("");
  const [memo, setMemo] = useState("");
  const [team, setTeam] = useState(initial.team ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || !date) {
      alert("제목과 날짜는 필수예요.");
      return;
    }
    setBusy(true);
    try {
      const finalTeam = teams.includes(team) ? team : "";
      await setDoc(doc(db, "events", crypto.randomUUID()), {
        title: title.trim(),
        date,
        startTime,
        endTime,
        location: location.trim(),
        memo: memo.trim(),
        team: finalTeam,
        createdAt: Date.now(),
      });
      onSaved({ date, startTime, endTime, title: title.trim(), team: finalTeam });
    } finally {
      setBusy(false);
    }
  }

  const chip = "rounded-lg bg-surface px-3 py-1.5 text-[15px] text-slate-800 outline-none focus:ring-2 focus:ring-accent/20";

  return (
    <div className="space-y-3">
      {/* 대상 팀 (팀이 있을 때만) */}
      {teams.length > 0 && (
        <div className="card !p-3">
          <p className="mb-2 px-1 text-xs font-semibold text-slate-500">대상</p>
          <div className="flex flex-wrap gap-1.5">
            {([["", "전체 공통"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => (
              <button
                key={val || "all"}
                type="button"
                onClick={() => setTeam(val)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  team === val ? "border-accent bg-accent text-accent-fg" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 제목 + 장소 — 칸 안에 안내문 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <input
          className="w-full bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-slate-400"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
        />
        <input
          className="w-full bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-slate-400"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="장소"
        />
      </div>

      {/* 날짜·시간 (한 카드, 줄마다 구분선) */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">날짜</span>
          <input type="date" className={chip} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">시작</span>
          <input type="time" className={chip} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">종료</span>
          <input type="time" className={chip} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>

      {/* 메모 (펼쳤을 때) */}
      {more && (
        <div className="card !p-0 overflow-hidden">
          <textarea
            className="w-full min-h-[80px] resize-none bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-slate-400"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모·준비물"
          />
        </div>
      )}

      {!more && (
        <button onClick={() => setMore(true)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
          + 메모 추가
        </button>
      )}

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-accent flex-1">{busy ? "등록 중…" : "등록"}</button>
        <button onClick={onCancel} className="btn-ghost">취소</button>
      </div>
    </div>
  );
}
