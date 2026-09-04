"use client";

// 확정 일정 등록 폼 (일정 페이지 + 조율 확정 + 전역 바텀시트 공용)

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { pushToAll, pushToUsers } from "@/lib/push";
import {
  shortDateKo,
  shortTimeKo,
  buildMonthGrid,
  toDateStr,
  TIME_SLOTS,
  slotEnd,
  WEEKDAYS_KO,
  ampmTimeKo,
} from "@/lib/utils";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { getMembers } from "@/lib/members";
import Avatar from "@/components/Avatar";
import Spinner from "@/components/Spinner";
import { CalendarIcon } from "@/components/Icons";
import type { ExternalBooking, PublicProfile, ScheduleEvent } from "@/lib/types";

export type SavedEvent = { date: string; startTime: string; endTime: string; title: string; team: string };

// "HH:mm" → 분
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// 이미 일정이 있는 시간을 그래도 고른 칸 — 빗금으로 '겹침'을 계속 알려 준다
const OVERLAP_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 6px)",
};

// ---------- 날짜 겹침 경고 (예약 신청 시트와 동일) ----------
function DateConflictModal({
  date,
  events,
  onCancel,
  onConfirm,
}: {
  date: string | null;
  events: ScheduleEvent[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!date) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-rose-500">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
        </div>
        <p className="text-center text-[15px] font-bold text-slate-900">
          현재 다른 일정이 있는 날짜입니다.
          <br />
          그래도 선택하시겠습니까?
        </p>
        <div className="mt-3 space-y-1.5 rounded-xl bg-surface p-3">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm">
              <CalendarIcon className={`h-4 w-4 shrink-0 ${e.source === "external" ? "text-emerald-500" : "text-slate-400"}`} />
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{e.title}</span>
              {e.startTime && (
                <span className="shrink-0 text-xs text-slate-400">
                  {e.startTime}
                  {e.endTime ? `~${e.endTime}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-accent-fg transition hover:brightness-110"
          >
            그래도 선택
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- 인라인 달력 그리드 ----------
function MiniCalendar({ grid, renderCell }: { grid: (Date | null)[]; renderCell: (d: Date) => React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-slate-400">
        {WEEKDAYS_KO.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((d, i) => (
          <div key={i} className="aspect-square">{d ? renderCell(d) : null}</div>
        ))}
      </div>
    </div>
  );
}

// ---------- 인라인 시간 타임바 (간소화: 히트맵 없음) ----------
function SimpleTimeRangeBar({
  mySlots,
  anchor,
  onTap,
  disabledSlots,
}: {
  mySlots: string[];
  anchor: string | null;
  onTap: (slot: string) => void;
  disabledSlots?: Set<string>;
}) {
  const hours = useMemo(() => [...new Set(TIME_SLOTS.map((s) => s.slice(0, 2)))], []);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4">
      <div className="w-max">
        {/* 시간 레이블 */}
        <div className="relative flex h-5">
          {hours.map((h, i) => {
            const n = Number(h);
            const disp = n === 12 ? 12 : n % 12;
            const label = n === 12 ? "정오" : `${disp}시`;
            return (
              <div key={h} className="relative w-[52px] shrink-0">
                <span className={`absolute bottom-0 whitespace-nowrap text-[11px] font-semibold text-slate-500 ${
                  i === 0 ? "left-0" : "left-0 -translate-x-1/2"
                }`}>
                  {label}
                </span>
              </div>
            );
          })}
          <div className="relative w-0 shrink-0">
            <span className="absolute bottom-0 left-0 -translate-x-full whitespace-nowrap text-[11px] font-semibold text-slate-500">
              자정
            </span>
          </div>
        </div>

        {/* 막대 + 틱마크 */}
        <div className="relative pt-[6px]">
          <div className="flex h-10 overflow-hidden rounded-lg border border-slate-200">
            {hours.map((h) => {
              const s0 = `${h}:00`;
              const s1 = `${h}:30`;
              const on0 = mySlots.includes(s0);
              const on1 = mySlots.includes(s1);
              const isAnchor0 = anchor === s0;
              const isAnchor1 = anchor === s1;
              const dis0 = !!disabledSlots?.has(s0);
              const dis1 = !!disabledSlots?.has(s1);
              return (
                <div key={h} className="flex h-full w-[52px] shrink-0">
                  {/* 이미 일정이 있는 칸도 관리자는 고를 수 있다 (겹치는 일정이 필요할 때가 있다).
                      고르기 전엔 회색으로, 고르고 나면 빗금으로 '겹침'을 계속 보여 준다. */}
                  <button
                    type="button"
                    onClick={() => onTap(s0)}
                    title={`${s0}~${slotEnd(s0)}${dis0 ? " · 이미 일정이 있는 시간" : ""}`}
                    style={on0 && dis0 ? OVERLAP_STYLE : undefined}
                    className={`h-full w-[26px] border-r border-dashed border-slate-200 transition ${
                      on0 ? "bg-accent" : dis0 ? "bg-slate-300" : isAnchor0 ? "bg-accent/30" : ""
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => onTap(s1)}
                    title={`${s1}~${slotEnd(s1)}${dis1 ? " · 이미 일정이 있는 시간" : ""}`}
                    style={on1 && dis1 ? OVERLAP_STYLE : undefined}
                    className={`h-full w-[26px] transition ${
                      on1 ? "bg-accent" : dis1 ? "bg-slate-300" : isAnchor1 ? "bg-accent/30" : ""
                    }`}
                  />
                </div>
              );
            })}
          </div>

          {/* 시간 경계 틱마크 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 flex">
            {hours.map((h, i) =>
              i === 0 ? (
                <div key={h} className="w-[52px] shrink-0" />
              ) : (
                <div key={h} className="relative w-[52px] shrink-0">
                  <div className="absolute bottom-0 left-[-1px] top-0 w-[2px] rounded-t-full bg-slate-400" />
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 날짜 라벨 ----------
function dateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
}

export default function EventForm({
  eventId,
  initial,
  onSaved,
  onCancel,
  submitRef,
  eventsByDate: eventsByDateProp,
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
  /**
   * 날짜별 기존 일정 — 달력 점·겹침 경고·시간바 회색 처리에 쓴다.
   * 안 넘기면(전역 등록 시트) 이 컴포넌트가 직접 읽어 온다.
   */
  eventsByDate?: Record<string, ScheduleEvent[]>;
}) {
  const { settings } = useTheme();
  const { user } = useAuth();
  const teams = settings.teams ?? [];
  const [title, setTitle] = useState(initial.title ?? "");
  const [location, setLocation] = useState(initial.location ?? "스튜디오 얼라이브");
  const locationRef = useRef<HTMLInputElement>(null);
  const [memo, setMemo] = useState(initial.memo ?? "");
  const [team, setTeam] = useState(initial.team ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  // ---------- 달력 + 타임바 상태 ----------
  const todayStr = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(initial.date || null);
  const [cursor, setCursor] = useState(() => {
    const d = initial.date ? new Date(initial.date + "T00:00:00") : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  // ---------- 기존 일정 (달력 점 · 겹침 경고 · 시간바 회색) ----------
  // prop으로 받으면 그대로 쓰고, 없으면(전역 등록 시트) 직접 읽는다.
  const [selfLoaded, setSelfLoaded] = useState<Record<string, ScheduleEvent[]> | null>(null);
  useEffect(() => {
    if (eventsByDateProp) return;
    let alive = true;
    (async () => {
      try {
        const [evSnap, exSnap] = await Promise.all([
          getDocs(collection(db, "events")),
          getDocs(collection(db, "externalBookings")).catch(() => null),
        ]);
        const list: ScheduleEvent[] = evSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ScheduleEvent, "id">),
        }));
        for (const d of exSnap?.docs ?? []) {
          const b = d.data() as Omit<ExternalBooking, "id">;
          list.push({
            id: `ext_${d.id}`,
            title: "외부 손님 예약",
            date: b.date,
            startTime: b.startTime ?? "",
            endTime: b.endTime ?? "",
            location: "",
            memo: "",
            createdAt: b.createdAt,
            source: "external",
          });
        }
        if (!alive) return;
        const m: Record<string, ScheduleEvent[]> = {};
        for (const e of list) (m[e.date] ??= []).push(e);
        setSelfLoaded(m);
      } catch {
        if (alive) setSelfLoaded({});
      }
    })();
    return () => { alive = false; };
  }, [eventsByDateProp]);

  // 수정 중인 일정 자신은 '겹치는 일정'이 아니다 — 빼고 본다
  const eventsByDate = useMemo(() => {
    const src = eventsByDateProp ?? selfLoaded ?? {};
    if (!eventId) return src;
    const m: Record<string, ScheduleEvent[]> = {};
    for (const [ds, list] of Object.entries(src)) {
      const kept = list.filter((e) => e.id !== eventId);
      if (kept.length > 0) m[ds] = kept;
    }
    return m;
  }, [eventsByDateProp, selfLoaded, eventId]);

  const [conflictDate, setConflictDate] = useState<string | null>(null);

  // 시간바 슬롯
  const [mySlots, setMySlots] = useState<string[]>(() => {
    // 초기값이 있으면 슬롯으로 변환
    if (initial.startTime && initial.endTime) {
      const iA = TIME_SLOTS.indexOf(initial.startTime);
      // endTime은 슬롯 끝이므로 한 칸 앞 슬롯까지 선택
      const endSlotTime = initial.endTime;
      const slots: string[] = [];
      for (const s of TIME_SLOTS) {
        if (s >= initial.startTime && slotEnd(s) <= endSlotTime) slots.push(s);
      }
      // 정확히 맞아떨어지지 않으면 startTime 한 칸만
      return slots.length > 0 ? slots : iA >= 0 ? [initial.startTime] : [];
    }
    return [];
  });
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  // 슬롯 → startTime, endTime
  const startTime = mySlots.length > 0 ? mySlots[0] : "";
  const endTime = mySlots.length > 0 ? slotEnd(mySlots[mySlots.length - 1]) : "";

  // 이미 일정이 잡힌 시간대 — 회색으로 막는다
  const disabledSlots = useMemo(() => {
    const set = new Set<string>();
    if (!selectedDate) return set;
    for (const e of eventsByDate[selectedDate] ?? []) {
      if (!e.startTime) continue;
      const startM = toMinutes(e.startTime);
      let endM = e.endTime ? toMinutes(e.endTime) : startM + 30;
      if (endM <= startM) endM = 24 * 60;
      for (const s of TIME_SLOTS) {
        const sM = toMinutes(s);
        const eM = toMinutes(slotEnd(s));
        if (sM < endM && eM > startM) set.add(s);
      }
    }
    return set;
  }, [selectedDate, eventsByDate]);

  // 이미 일정이 있는 칸도 고를 수 있다 — 막지 않고 아래에 경고만 띄운다.
  // (다른 공간에서 동시에 연습하는 등, 일부러 겹쳐야 할 때가 있다)
  function tapSlot(slot: string) {
    if (rangeAnchor === null) {
      setMySlots([]);
      setRangeAnchor(slot);
    } else {
      const iA = TIME_SLOTS.indexOf(rangeAnchor);
      const iB = TIME_SLOTS.indexOf(slot);
      const [lo, hi] = iA <= iB ? [iA, iB] : [iB, iA];
      setMySlots(TIME_SLOTS.slice(lo, hi + 1));
      setRangeAnchor(null);
    }
  }

  // 고른 구간이 기존 일정과 겹치는지
  const overlapCount = useMemo(
    () => mySlots.filter((s) => disabledSlots.has(s)).length,
    [mySlots, disabledSlots]
  );

  function pickDate(ds: string) {
    setSelectedDate(ds);
    setMySlots([]);
    setRangeAnchor(null);
  }

  function selectDate(ds: string) {
    if (selectedDate === ds) {
      setSelectedDate(null);
      setMySlots([]);
      setRangeAnchor(null);
      return;
    }
    // 다른 일정이 있는 날이면 한 번 물어본다
    if ((eventsByDate[ds] ?? []).length > 0) {
      setMySlots([]);
      setRangeAnchor(null);
      setConflictDate(ds);
      return;
    }
    pickDate(ds);
  }

  // 참여 인원 — 예약 신청 시트와 같은 팀/개별 카드
  const initialUids = initial.participantUids ?? [];
  const [audienceMode, setAudienceMode] = useState<"team" | "individual">(
    initialUids.length > 0 ? "individual" : "team"
  );
  const [selectedUids, setSelectedUids] = useState<string[]>(initialUids);
  const [members, setMembers] = useState<{ uid: string; name: string; avatar?: string; team?: string }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const currentProductionId = settings.currentProductionId ?? "";

  // 개별 탭을 처음 열 때만 명단을 받아 온다
  useEffect(() => {
    if (audienceMode !== "individual" || members.length > 0) return;
    setMembersLoading(true);
    (async () => {
      try {
        const all = await getMembers();   // 이름순 정렬은 캐시가 이미 해 둔다
        let filtered = all;
        if (currentProductionId) {
          const psnap = await getDoc(doc(db, "productions", currentProductionId));
          const parts = (psnap.data()?.participants as string[] | undefined) ?? [];
          if (parts.length > 0) {
            const set = new Set(parts);
            filtered = all.filter((m) => set.has(m.uid));
          }
        }
        setMembers(filtered);
      } finally {
        setMembersLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceMode, members.length]);

  function toggleUid(id: string) {
    setSelectedUids((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));
  }

  // 헤더 ✓ 버튼이 이 함수를 호출하도록 등록
  if (submitRef) submitRef.current = () => {
    if (!title.trim() || !selectedDate) {
      alert("제목과 날짜는 필수예요.");
      return false;
    }
    if (!startTime || !endTime) {
      alert("시간을 선택해 주세요. 시간바에서 시작과 끝 지점을 터치해 주세요.");
      return false;
    }
    if (audienceMode === "individual" && selectedUids.length === 0) {
      alert("참여 인원을 한 명 이상 선택해 주세요.");
      return false;
    }
    void save();
  };

  async function save() {
    if (!title.trim() || !selectedDate) return;
    if (!startTime || !endTime) return;
    if (audienceMode === "individual" && selectedUids.length === 0) return;
    setBusy(true);
    try {
      const individual = audienceMode === "individual" && selectedUids.length > 0;
      const finalTeam = individual ? "" : teams.includes(team) ? team : "";
      const data = {
        title: title.trim(),
        date: selectedDate,
        startTime,
        endTime,
        location: location.trim(),
        memo: memo.trim(),
        team: finalTeam,
        participantUids: individual ? selectedUids : [],
        participantLabel: individual ? `${selectedUids.length}명` : "",
      };
      // 알림 본문에 들어갈 때 — 24시간제 ("9월 7일 (월) 19:00–24:00")
      const when = when24(selectedDate, startTime, endTime);

      if (eventId) {
        await updateDoc(doc(db, "events", eventId), data);
        // 날짜·시간·장소가 바뀐 때만 알린다.
        // (제목·메모만 고칠 때마다 울리면 피곤하다)
        const movedDate  = initial.date      !== selectedDate;
        const movedTime  = initial.startTime !== startTime || initial.endTime !== endTime;
        const movedPlace = (initial.location ?? "") !== location.trim();
        if (movedDate || movedTime || movedPlace) {
          const changed = [
            movedDate || movedTime ? "시간" : "",
            movedPlace ? "장소" : "",
          ].filter(Boolean).join("·");
          const target = data.participantUids.length > 0 ? data.participantUids : null;
          // 알림은 '제목 1줄 + from ALIVE 1줄 + 본문 1줄' 세 줄로 맞춘다.
          // 길이가 변하는 일정 제목은 제목줄에 둔다 — 제목은 iOS가 한 줄로 잘라 주지만
          // 본문은 줄바꿈해서 늘어난다.
          const msg = {
            title: `일정 변경 · ${data.title}`,
            // 바뀐 것만 한 줄로. 시간이 바뀌었으면 시간, 장소만 바뀌었으면 장소.
            body: movedDate || movedTime ? when : `장소가 ${data.location}(으)로 변경됐어요.`,
            href: `/schedule?tab=events&date=${selectedDate}`,
            tag: `event-changed-${eventId}`,
          };
          if (target) void pushToUsers(target, msg);
          else void pushToAll(msg);
        }
      } else {
        // createdBy를 같이 남긴다 — 카드 상세의 '만든 사람'에 쓰인다.
        // (예전엔 단원 예약이 승인된 일정에만 기록돼서 관리자가 등록한 일정은 비어 있었다)
        await setDoc(doc(db, "events", crypto.randomUUID()), {
          ...data,
          createdBy: user?.uid ?? "",
          createdAt: Date.now(),
        });
        void pushToAll({
          title: `새 일정 · ${data.title}`,
          body: when,
          href: `/schedule?tab=events&date=${selectedDate}`,
          tag: "event",
        });
      }
      onSaved({ date: selectedDate, startTime, endTime, title: title.trim(), team: finalTeam });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 제목 + 장소 */}
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

      {/* 참여 인원 — 제목·장소 아래 */}
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

      {/* 날짜 + 시간 — 달력 그리드 + 타임바 */}
      <div className="card">
        <p className="font-bold text-slate-900">날짜 및 시간</p>
        <p className="mb-3 mt-0.5 text-xs leading-relaxed text-slate-400">
          날짜를 선택하면 아래에 시간바가 나타나요.
        </p>
        {/* 월 이동 */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            aria-label="이전 달"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            ‹
          </button>
          <span className="text-sm font-bold text-slate-800">
            {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
          </span>
          <button
            type="button"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            aria-label="다음 달"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            ›
          </button>
        </div>
        <MiniCalendar
          grid={grid}
          renderCell={(d) => {
            const ds = toDateStr(d);
            const isPast = ds < todayStr;
            const on = selectedDate === ds;
            const hasEvent = (eventsByDate[ds] ?? []).length > 0;
            if (isPast) {
              return (
                <div className="flex h-full w-full items-center justify-center rounded-lg text-sm text-slate-300">
                  {d.getDate()}
                </div>
              );
            }
            return (
              <button
                type="button"
                onClick={() => selectDate(ds)}
                className={`relative flex h-full w-full items-center justify-center rounded-lg text-sm transition ${
                  on ? "bg-accent font-bold text-accent-fg" : "bg-surface text-slate-600 hover:bg-slate-200"
                } ${!on && ds === todayStr ? "ring-1 ring-accent/50" : ""}`}
              >
                {d.getDate()}
                {hasEvent && (
                  <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${on ? "bg-accent-fg" : "bg-rose-400"}`} />
                )}
              </button>
            );
          }}
        />

        {/* 날짜 선택 시 시간바 표시 */}
        {selectedDate && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">{dateLabel(selectedDate)}</p>
                {startTime && endTime && (
                  <p className="text-[15px] font-bold text-slate-900 leading-snug">
                    {ampmTimeKo(startTime)} ~ {ampmTimeKo(endTime, false)}
                  </p>
                )}
              </div>
              {mySlots.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMySlots([]); setRangeAnchor(null); }}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  초기화
                </button>
              )}
            </div>
            <SimpleTimeRangeBar
              mySlots={mySlots}
              anchor={rangeAnchor}
              onTap={tapSlot}
              disabledSlots={disabledSlots}
            />
            {overlapCount > 0 ? (
              <p className="-mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11.5px] font-medium leading-relaxed text-amber-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="mt-px h-3.5 w-3.5 shrink-0">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16h.01" />
                </svg>
                이미 다른 일정이 있는 시간과 겹칩니다. 그대로 등록해도 괜찮아요.
              </p>
            ) : (
              disabledSlots.size > 0 && (
                <p className="-mt-2 text-[11px] text-slate-400">
                  회색 구간은 이미 다른 일정이 있어요. 필요하면 그대로 골라도 됩니다.
                </p>
              )
            )}
          </div>
        )}
      </div>

      {/* 다른 일정이 있는 날짜를 고르면 한 번 확인 */}
      <DateConflictModal
        date={conflictDate}
        events={conflictDate ? eventsByDate[conflictDate] ?? [] : []}
        onCancel={() => setConflictDate(null)}
        onConfirm={() => {
          if (conflictDate) pickDate(conflictDate);
          setConflictDate(null);
        }}
      />

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
