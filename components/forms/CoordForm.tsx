"use client";

// 일정 조율 카드 만들기 폼 (일정 페이지 + 전역 바텀시트 공용)

import { useState } from "react";
import type { Coordination } from "@/lib/types";

export type CoordFields = Omit<Coordination, "id" | "createdBy" | "createdByName" | "status" | "createdAt">;

export default function CoordForm({
  teams,
  onCreate,
  onCancel,
}: {
  teams: string[];
  onCreate: (fields: CoordFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [team, setTeam] = useState("");
  const [month, setMonth] = useState(""); // YYYY-MM
  const [deadline, setDeadline] = useState(""); // datetime-local
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) {
      alert("제목을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        ...(memo.trim() ? { memo: memo.trim() } : {}),
        ...(team ? { team } : {}),
        ...(month ? { targetMonth: month } : {}),
        ...(deadline ? { deadline: new Date(deadline).getTime() } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 대상 팀 (팀이 있을 때만) */}
      {teams.length > 0 && (
        <div className="card !p-3">
          <p className="mb-2 px-1 text-xs font-semibold text-slate-500">대상</p>
          <div className="flex flex-wrap gap-1.5">
            {([["", "전체"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => (
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

      {/* 제목 + 설명 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="조율 제목" />
        <textarea
          className="field min-h-[72px] resize-none"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="설명 (선택)"
        />
      </div>

      {/* 대상 달 · 마감일 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">대상 달</span>
          <input type="month" className="field-chip" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">마감일</span>
          <input type="datetime-local" className="field-chip" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-accent flex-1">{busy ? "만드는 중…" : "조율 만들기"}</button>
        <button onClick={onCancel} className="btn-ghost">취소</button>
      </div>
    </div>
  );
}
