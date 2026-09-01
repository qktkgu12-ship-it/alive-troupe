"use client";

// 확정 일정 등록 폼 (일정 페이지 + 조율 확정 + 전역 바텀시트 공용)

import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { pushToAll } from "@/lib/push";
import { shortDateKo, shortTimeKo } from "@/lib/utils";
import { useTheme } from "@/lib/theme-context";
import Avatar from "@/components/Avatar";
import Spinner from "@/components/Spinner";
import type { PublicProfile } from "@/lib/types";

export type SavedEvent = { date: string; startTime: string; endTime: string; title: string; team: string };

export default function EventForm({
  eventId,
  initial,
  onSaved,
  onCancel,
  submitRef,
}: {
  eventId?: string; // 수정 모드: 기존 문서 ID
  initial: {
    date: string; startTime: string; endTime: string;
    title?: string; team?: string; location?: string; memo?: string;
    participantUids?: string[];
  };
  onSaved: (saved: SavedEvent) => void;
  onCancel: () => void;
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const [title, setTitle] = useState(initial.title ?? "");
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState(initial.location ?? "스튜디오 얼라이브");
  const locationRef = useRef<HTMLInputElement>(null);
  const [memo, setMemo] = useState(initial.memo ?? "");
  const [team, setTeam] = useState(initial.team ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  // 참여 인원 — 예약 신청 시트와 같은 팀/개별 카드
  // 개별 명단이 있으면 그게 대상이고, 없으면 위의 팀이 대상이다.
  const initialUids = initial.participantUids ?? [];
  const [audienceMode, setAudienceMode] = useState<"team" | "individual">(
    initialUids.length > 0 ? "individual" : "team"
  );
  const [selectedUids, setSelectedUids] = useState<string[]>(initialUids);
  const [members, setMembers] = useState<{ uid: string; name: string; avatar?: string; team?: string }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const currentProductionId = settings.currentProductionId ?? "";

  // 개별 탭을 처음 열 때만 명단을 받아 온다 (예약 신청 시트와 같은 범위)
  useEffect(() => {
    if (audienceMode !== "individual" || members.length > 0) return;
    setMembersLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collection(db, "publicProfiles"));
        const all = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }));
        let filtered = all;
        if (currentProductionId) {
          const psnap = await getDoc(doc(db, "productions", currentProductionId));
          const parts = (psnap.data()?.participants as string[] | undefined) ?? [];
          if (parts.length > 0) {
            const set = new Set(parts);
            filtered = all.filter((m) => set.has(m.uid));
          }
        }
        setMembers(filtered.sort((a, b) => a.name.localeCompare(b.name, "ko")));
      } finally {
        setMembersLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceMode, members.length]);

  function toggleUid(id: string) {
    setSelectedUids((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));
  }

  // 헤더 ✓ 버튼이 이 함수를 호출하도록 등록 (유효성 실패 시 false 반환 → 바텀시트 유지)
  if (submitRef) submitRef.current = () => {
    if (!title.trim() || !date) {
      alert("제목과 날짜는 필수예요.");
      return false;
    }
    if (audienceMode === "individual" && selectedUids.length === 0) {
      alert("참여 인원을 한 명 이상 선택해 주세요.");
      return false;
    }
    void save();
  };

  async function save() {
    if (!title.trim() || !date) return;
    if (audienceMode === "individual" && selectedUids.length === 0) return;
    setBusy(true);
    try {
      const individual = audienceMode === "individual" && selectedUids.length > 0;
      const finalTeam = individual ? "" : teams.includes(team) ? team : "";
      const data = {
        title: title.trim(),
        date,
        startTime,
        endTime,
        location: location.trim(),
        memo: memo.trim(),
        team: finalTeam,
        // 수정 시 개별 → 팀으로 되돌렸다면 빈 배열로 덮어써야 옛 명단이 안 남는다
        participantUids: individual ? selectedUids : [],
        participantLabel: individual ? `${selectedUids.length}명` : "",
      };
      if (eventId) {
        await updateDoc(doc(db, "events", eventId), data);
      } else {
        await setDoc(doc(db, "events", crypto.randomUUID()), { ...data, createdAt: Date.now() });
        // 새 일정만 알린다 (수정할 때마다 울리면 피곤하다)
        // 내용은 "일정 이름 / 8월 20일 19시 ~ 21시" 두 줄
        const when = [
          shortDateKo(date),
          [shortTimeKo(startTime), endTime ? shortTimeKo(endTime) : ""].filter(Boolean).join(" ~ "),
        ]
          .filter(Boolean)
          .join(" ");
        void pushToAll({
          title: "새 일정이 등록됐어요",
          body: [data.title, when].filter(Boolean).join("\n"),
          href: `/schedule?tab=events&date=${date}`,
          tag: "event",
        });
      }
      onSaved({ date, startTime, endTime, title: title.trim(), team: finalTeam });
    } finally {
      setBusy(false);
    }
  }

  const chip = "field-chip";

  return (
    <div className="space-y-3">
      {/* 참여 인원 — 예약 신청 시트와 같은 팀/개별 카드 */}
      <div className="card !p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="px-1 text-xs font-semibold text-slate-500">참여 인원</p>
          <div className="flex gap-0.5 rounded-lg bg-surface p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setAudienceMode("team")}
              className={`rounded-md px-2.5 py-1 transition ${audienceMode === "team" ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
            >
              팀
            </button>
            <button
              type="button"
              onClick={() => setAudienceMode("individual")}
              className={`rounded-md px-2.5 py-1 transition ${audienceMode === "individual" ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
            >
              개별
            </button>
          </div>
        </div>

        {audienceMode === "team" ? (
          <div className="flex flex-wrap gap-1.5 px-1">
            {([["", "전체"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => (
              <button
                key={val || "all"}
                type="button"
                onClick={() => setTeam(val)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  team === val ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : membersLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (
          <>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {members.map((m) => {
                const on = selectedUids.includes(m.uid);
                return (
                  <button
                    key={m.uid}
                    type="button"
                    onClick={() => toggleUid(m.uid)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
                  >
                    <Avatar src={m.avatar} name={m.name} className="h-7 w-7 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{m.name}</span>
                    {m.team && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {m.team}
                      </span>
                    )}
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${on ? "border-slate-800 bg-slate-800" : "border-slate-300"}`}>
                      {on && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <path d="M4 13l5 5L20 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedUids.length > 0 && (
              <p className="mt-1.5 px-1 text-xs font-semibold text-accent">{selectedUids.length}명 선택됨</p>
            )}
          </>
        )}
      </div>

      {/* 제목 + 장소 — 칸 안에 안내문 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
        />
        <div className="flex items-center">
          <input
            ref={locationRef}
            className="field flex-1 !border-0 !shadow-none"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="장소"
          />
          {location && (
            <button
              type="button"
              onClick={() => { setLocation(""); locationRef.current?.focus(); }}
              aria-label="장소 지우기"
              className="mr-3 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-500 transition hover:bg-slate-300"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-3 w-3">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
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
            className="field min-h-[80px] resize-none"
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

    </div>
  );
}
