"use client";

// 일정 조율 카드 만들기 폼 (일정 페이지 + 전역 바텀시트 공용)

import { useState } from "react";
import Select from "@/components/Select";
import type { Coordination } from "@/lib/types";

export type CoordFields = Omit<Coordination, "id" | "createdBy" | "createdByName" | "status" | "createdAt">;

export default function CoordForm({
  teams,
  onCreate,
  onCancel,
  bare = false,
}: {
  teams: string[];
  onCreate: (fields: CoordFields) => Promise<void>;
  onCancel: () => void;
  bare?: boolean; // true = 카드 테두리 없이 (바텀시트 안에서 사용)
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
    <div className={bare ? "space-y-3" : "card space-y-3"}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="조율 제목 (예: 1월 워크샵 일정)" />
      <textarea className="input min-h-[60px]" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="설명 (선택)" />
      {teams.length > 0 && (
        <div>
          <label className="label">대상 팀</label>
          <Select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">전체</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">대상 달 (선택)</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div>
          <label className="label">마감일 (선택)</label>
          <input type="datetime-local" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-ghost">취소</button>
        <button onClick={submit} disabled={busy} className="btn-accent flex-1">{busy ? "만드는 중…" : "조율 만들기"}</button>
      </div>
    </div>
  );
}
