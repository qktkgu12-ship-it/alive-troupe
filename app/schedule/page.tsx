"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import BottomSheet from "@/components/BottomSheet";
import EventForm from "@/components/forms/EventForm";
import { useCreateSheet } from "@/lib/create-sheet-context";
import { ProfileAvatar } from "@/components/ProfileViewer";
import EmptyState from "@/components/EmptyState";
import EventMeta from "@/components/EventMeta";
import { CalendarIcon, ClockIcon, EyeOffIcon, EyeIcon, PencilIcon, PlusIcon, ShareIcon, TrashIcon, XIcon } from "@/components/Icons";
import type { Absence, Availability, Coordination, PublicProfile, ScheduleEvent } from "@/lib/types";
import {
  buildMonthGrid,
  slotEnd,
  TIME_SLOTS,
  toDateStr,
  toYearMonth,
  WEEKDAYS_KO,
} from "@/lib/utils";

type Tab = "events" | "coord";

const TAB_ORDER: Tab[] = ["events", "coord"];
const TAB_INFO: Record<Tab, { label: string }> = {
  events: { label: "확정" },
  coord: { label: "일정 잡기" },
};

function dateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: WEEKDAYS_KO[d.getDay()] };
}

function deadlineLabel(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "2026년 8월 27일 (목)"
function fullDateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
}

// 종료시간(없으면 시작시간, 둘 다 없으면 그날 자정)이 지났으면 '지난 일정'
function eventPassed(e: ScheduleEvent): boolean {
  const [y, m, d] = e.date.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const end = e.endTime || e.startTime;
  if (end) {
    const [hh, mm] = end.split(":").map(Number);
    dt.setHours(hh || 0, mm || 0, 0, 0);
  } else {
    dt.setHours(23, 59, 59, 999);
  }
  return dt.getTime() < Date.now();
}


// 가능 인원 비율 → 초록 히트맵 색 (타임바 슬롯용)
function heatStyle(count: number, denom: number, max: number) {
  if (count <= 0) return undefined;
  const ratio = denom > 0 ? count / denom : max > 0 ? count / max : 0;
  const t = Math.min(1, ratio);
  return {
    backgroundColor: `rgba(16,185,129,${0.12 + 0.55 * t})`,
    borderColor: `rgba(16,185,129,${0.35 + 0.4 * t})`,
  };
}

// 가능 인원 비율 → 빨간 테두리 히트맵 (달력 날짜 셀용)
function redBorderHeatStyle(count: number, denom: number, max: number) {
  if (count <= 0) return undefined;
  const ratio = denom > 0 ? count / denom : max > 0 ? count / max : 0;
  const t = Math.min(1, ratio);
  return {
    borderColor: `rgba(220,38,38,${0.25 + 0.75 * t})`,
    backgroundColor: `rgba(220,38,38,${0.03 + 0.08 * t})`,
  };
}

// 팀 순서 기반 색상 팔레트 (첫 번째 팀=파스텔민트, 두 번째 팀=파스텔보라, 이후=회색)
// border/color: 칩 테두리·텍스트용 / bg: 달력 셀 배경 채우기용
const TEAM_PALETTE: { border: string; color: string; bg: string }[] = [
  { border: "rgb(94,234,212)", color: "rgb(15,118,110)", bg: "rgba(94,234,212,0.28)" },   // pastel mint
  { border: "rgb(196,181,253)", color: "rgb(109,40,217)", bg: "rgba(196,181,253,0.35)" }, // pastel violet
];

// 네이버 예약 (source='naver') 전용 초록색
const NAVER_COLOR = { border: "rgb(34,197,94)", color: "rgb(21,128,57)", bg: "rgba(34,197,94,0.15)" };

function getTeamColor(team: string | undefined, teams: string[]) {
  if (!team) return null;
  const idx = teams.indexOf(team);
  if (idx < 0) return null;
  return TEAM_PALETTE[idx] ?? { border: "rgb(148,163,184)", color: "rgb(100,116,139)", bg: "rgba(148,163,184,0.2)" };
}

// 이벤트 색상 결정 (팀색 우선, 네이버 예약이면 초록)
function getEventColor(e: { team?: string; source?: string }, teams: string[]) {
  const tc = getTeamColor(e.team, teams);
  if (tc) return tc;
  if (e.source === 'naver') return NAVER_COLOR;
  return null;
}

// 팀별 달력 칩 색상 (배경 채우기 — 전체 일정과 동일한 방식, 팀 파스텔 색으로)
function teamChipStyle(team: string | undefined, teams: string[], passed = false): React.CSSProperties {
  if (passed || !team) return {};
  const c = getTeamColor(team, teams);
  if (!c) return {};
  return { backgroundColor: c.bg, color: c.color };
}

// "HH:mm" → { time: "H:MM", ampm: "AM"|"PM" }
function formatTimeParts(t: string | undefined): { time: string; ampm: string } {
  if (!t) return { time: "—", ampm: "" };
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { time: `${hour}:${String(m).padStart(2, "0")}`, ampm };
}

// "HH:mm" → "H:MM AM/PM"
function formatTime(t: string | undefined) {
  if (!t) return "";
  const p = formatTimeParts(t);
  return `${p.time} ${p.ampm}`;
}

// 슬롯 "HH:mm" → "H:mm" 표기 (오전/오후 생략)
function fmtTime(s: string) {
  const [h, m] = s.split(":").map(Number);
  if (h >= 24) return "24:00";
  const disp = h === 12 ? 12 : h % 12;
  return `${disp}:${String(m).padStart(2, "0")}`;
}

// 휴대폰 공유창 (미지원 브라우저는 링크 복사로 대체)
async function shareLink(title: string, url: string) {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, url });
      return;
    }
  } catch {
    return; // 사용자가 공유를 취소한 경우
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("링크를 복사했어요. 단톡방에 붙여넣어 주세요.");
  } catch {
    prompt("아래 링크를 복사해 주세요.", url);
  }
}

// 팀 배지 (전체 공통이면 표시 안 함)
function TeamBadge({ team, className = "" }: { team?: string; className?: string }) {
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  if (!team) return null;
  const c = getTeamColor(team, teams);
  const style: React.CSSProperties = c ? { backgroundColor: c.bg, color: c.color } : {};
  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${!c ? "bg-slate-100 text-slate-500" : ""} ${className}`}
    >
      {team}
    </span>
  );
}

// 일정방의 대상(팀 또는 개별 지정 인원) 배지
function AudienceBadge({ coord, className = "" }: { coord: Coordination; className?: string }) {
  if (coord.participantUids && coord.participantUids.length > 0) {
    return (
      <span className={`inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent ${className}`}>
        {coord.participantUids.length}명 개별 지정
      </span>
    );
  }
  return <TeamBadge team={coord.team} className={className} />;
}

function ScheduleInner() {
  const { user, profile, role } = useAuth();
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const myTeam = profile?.team ?? "";
  const isAdmin = role === "admin";

  const [tab, setTab] = useState<Tab>("events");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [highlightEvent, setHighlightEvent] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const [openNewEvent, setOpenNewEvent] = useState(false);
  const [openNewCoord, setOpenNewCoord] = useState(false);

  // 팀별 단원 수(응답 진행률의 분모) — publicProfiles 1회 집계
  const [memberStat, setMemberStat] = useState<{ total: number; byTeam: Record<string, number> }>({ total: 0, byTeam: {} });
  const loadMemberStat = useCallback(async () => {
    const snap = await getDocs(collection(db, "publicProfiles"));
    const byTeam: Record<string, number> = {};
    let total = 0;
    snap.forEach((d) => {
      total++;
      const p = d.data() as PublicProfile;
      if (p.team) byTeam[p.team] = (byTeam[p.team] ?? 0) + 1;
    });
    setMemberStat({ total, byTeam });
  }, []);
  useEffect(() => {
    loadMemberStat();
  }, [loadMemberStat]);

  // 홈·헤더에서 넘어온 경우 (탭 이동 / 일정 강조 / 등록 폼 열기)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tabParam = p.get("tab");
    if (tabParam === "coord") setTab("coord");
    else if (tabParam === "events" || tabParam === "past") setTab("events");
    if (p.get("new") === "1") {
      if (tabParam === "coord") setOpenNewCoord(true);
      else setOpenNewEvent(true);
    }
    const dateParam = p.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const [y, m] = dateParam.split("-").map(Number);
      setCursor(new Date(y, m - 1, 1));
      setHighlightDate(dateParam);
    }
    const ev = p.get("event");
    if (ev) {
      setHighlightEvent(ev);
      const t = setTimeout(() => setHighlightEvent(null), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const yearMonth = toYearMonth(cursor);

  // 확정 일정 (보는 달)
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const loadEvents = useCallback(async () => {
    const snap = await getDocs(
      query(collection(db, "events"), where("date", ">=", `${yearMonth}-01`), where("date", "<=", `${yearMonth}-31`))
    );
    setEvents(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    );
  }, [yearMonth]);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 헤더 '+' 바텀시트로 확정 일정을 만들면 새로고침
  const { createdAt } = useCreateSheet();
  useEffect(() => {
    if (createdAt?.kind === "event") loadEvents();
  }, [createdAt, loadEvents]);

  function changeMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">일정</h1>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-surface p-1 text-sm font-medium">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-2 py-2 transition ${tab === t ? "bg-white text-accent shadow-sm" : "text-slate-500"}`}
          >
            {TAB_INFO[t].label}
          </button>
        ))}
      </div>

      {tab === "events" && (
        <EventsSection
          monthLabel={`${year}년 ${month0 + 1}월`}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          yearMonth={yearMonth}
          events={events}
          isAdmin={isAdmin}
          onChanged={loadEvents}
          highlightId={highlightEvent}
          highlightDate={highlightDate}
          teams={teams}
          myTeam={myTeam}
          openNew={openNewEvent}
          onNewHandled={() => setOpenNewEvent(false)}
        />
      )}

      {tab === "coord" && (
        <CoordSection
          isAdmin={isAdmin}
          uid={user?.uid ?? ""}
          myName={profile?.name || profile?.displayName || ""}
          myAvatar={profile?.avatar || ""}
          myTeam={myTeam}
          teams={teams}
          memberStat={memberStat}
          openNew={openNewCoord}
          onNewHandled={() => setOpenNewCoord(false)}
          onConfirmed={() => {
            loadEvents();
          }}
        />
      )}
    </div>
  );
}

// ---------- 달력 그리드 공통 ----------
function CalendarGrid({ grid, renderCell }: { grid: (Date | null)[]; renderCell: (d: Date) => React.ReactNode }) {
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

// ---------- 시간 타임바 (범위 선택 · 1자 막대 · 틱마크 위아래 돌출) ----------
function TimeRangeBar({
  mySlots,
  othersBySlot,
  denom,
  maxDateCount,
  anchor,
  onTap,
  locked,
}: {
  mySlots: string[];
  othersBySlot: Record<string, number>;
  denom: number;
  maxDateCount: number;
  anchor: string | null;
  onTap: (slot: string) => void;
  locked: boolean;
}) {
  const hours = useMemo(() => [...new Set(TIME_SLOTS.map((s) => s.slice(0, 2)))], []);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4">
      <div className="w-max">
        {/* 1시간 단위 레이블 — 틱 중앙 정렬 */}
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
          {/* 자정 라벨 — 타임바 맨 끝 */}
          <div className="relative w-0 shrink-0">
            <span className="absolute bottom-0 left-0 -translate-x-full whitespace-nowrap text-[11px] font-semibold text-slate-500">
              자정
            </span>
          </div>
        </div>

        {/* 막대 + 상단 6px 돌출 틱마크 */}
        <div className="relative pt-[6px]">
          {/* 막대: 30분 경계 점선만, 시간 경계 실선은 틱으로만 표시 */}
          <div className="flex h-10 overflow-hidden rounded-lg border border-slate-200">
            {hours.map((h, i) => {
              const s0 = `${h}:00`;
              const s1 = `${h}:30`;
              const on0 = mySlots.includes(s0);
              const on1 = mySlots.includes(s1);
              const isAnchor0 = anchor === s0;
              const isAnchor1 = anchor === s1;
              return (
                <div key={h} className="flex h-full w-[52px] shrink-0">
                  {/* :00 슬롯 */}
                  <button
                    type="button"
                    onClick={() => onTap(s0)}
                    disabled={locked}
                    title={`${s0}~${slotEnd(s0)}${othersBySlot[s0] ? ` · ${othersBySlot[s0]}명 가능` : ""}${isAnchor0 ? " · 시작점" : ""}`}
                    style={!on0 && !isAnchor0 ? heatStyle(othersBySlot[s0] ?? 0, denom, maxDateCount) : undefined}
                    className={`h-full w-[26px] border-r border-dashed border-slate-200 transition ${
                      on0 ? "bg-accent" : isAnchor0 ? "bg-accent/30" : ""
                    }`}
                  />
                  {/* :30 슬롯 */}
                  <button
                    type="button"
                    onClick={() => onTap(s1)}
                    disabled={locked}
                    title={`${s1}~${slotEnd(s1)}${othersBySlot[s1] ? ` · ${othersBySlot[s1]}명 가능` : ""}${isAnchor1 ? " · 시작점" : ""}`}
                    style={!on1 && !isAnchor1 ? heatStyle(othersBySlot[s1] ?? 0, denom, maxDateCount) : undefined}
                    className={`h-full w-[26px] transition ${
                      on1 ? "bg-accent" : isAnchor1 ? "bg-accent/30" : ""
                    }`}
                  />
                </div>
              );
            })}
          </div>

          {/* 시간 경계 틱마크 — 상단 6px 돌출, 하단은 막대 바닥에 맞춤 */}
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

/* =========================================================================
   일정 잡기 — 목록 / 만들기 / 상세
   ========================================================================= */

function CoordSection({
  isAdmin,
  uid,
  myName,
  myAvatar,
  myTeam,
  teams,
  memberStat,
  openNew,
  onNewHandled,
  onConfirmed,
}: {
  isAdmin: boolean;
  uid: string;
  myName: string;
  myAvatar: string;
  myTeam: string;
  teams: string[];
  memberStat: { total: number; byTeam: Record<string, number> };
  openNew: boolean;
  onNewHandled?: () => void;
  onConfirmed: () => void;
}) {
  const [coords, setCoords] = useState<Coordination[]>([]);
  const [respCount, setRespCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null); // 만든 직후 확인 시트
  const coordCreateRef = useRef<(() => void) | null>(null);
  const coordSectionTopRef = useRef<HTMLDivElement>(null);

  const denomOf = useCallback(
    (c: Coordination) =>
      c.participantUids && c.participantUids.length > 0
        ? c.participantUids.length
        : c.team
          ? memberStat.byTeam[c.team] ?? 0
          : memberStat.total,
    [memberStat]
  );

  const loadCoords = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "coordinations"), orderBy("createdAt", "desc")));
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Coordination, "id">) }));
      setCoords(list);
      // 카드별 응답 인원 (방 수가 많지 않아 방마다 1회 조회)
      const counts = await Promise.all(
        list.map(async (c) => {
          const av = await getDocs(collection(db, "coordinations", c.id, "availability"));
          return [c.id, av.size] as const;
        })
      );
      setRespCount(Object.fromEntries(counts));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoords();
  }, [loadCoords]);

  useEffect(() => {
    if (openNew) {
      setShowCreate(true);
      onNewHandled?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew]);

  async function createCoord(fields: {
    title: string;
    location: string;
    team: string;
    participantUids?: string[];
    candidateDates: string[];
    deadline?: number;
  }) {
    if (!uid) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, "coordinations", id), {
      title: fields.title,
      location: fields.location,
      team: fields.team,
      ...(fields.participantUids && fields.participantUids.length > 0
        ? { participantUids: fields.participantUids }
        : {}),
      candidateDates: fields.candidateDates,
      ...(fields.deadline ? { deadline: fields.deadline } : {}),
      createdBy: uid,
      createdByName: myName,
      status: "open",
      createdAt: Date.now(),
    });
    setShowCreate(false);
    await loadCoords();
    setCreatedId(id);
  }

  async function removeCoord(c: Coordination) {
    if (!confirm(`'${c.title}' 일정방을 삭제할까요? 제출된 가능 시간도 함께 사라져요.`)) return;
    const av = await getDocs(collection(db, "coordinations", c.id, "availability"));
    await Promise.all(av.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "coordinations", c.id));
    if (openId === c.id) setOpenId(null);
    await loadCoords();
  }

  const openCoord = coords.find((c) => c.id === openId) ?? null;
  const createdCoord = coords.find((c) => c.id === createdId) ?? null;
  const linkOf = (id: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/schedule?tab=coord&room=${id}`;

  // 링크로 들어온 경우 해당 방 바로 열기
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) setOpenId(room);
  }, []);

  // CoordDetail 저장 ref (BottomSheet ✓ 버튼에 연결)
  const coordDetailSaveRef = useRef<(() => void) | null>(null);

  // ✓ 버튼 표시 여부: 참여 대상이고 잠기지 않은 경우만
  const isParticipantOfOpen = openCoord ? (
    isAdmin || (
      openCoord.participantUids && openCoord.participantUids.length > 0
        ? openCoord.participantUids.includes(uid)
        : !openCoord.team || !myTeam || openCoord.team === myTeam
    )
  ) : false;
  const lockedOpen = openCoord
    ? (!!openCoord.deadline && Date.now() > openCoord.deadline) || openCoord.status === "done"
    : false;

  return (
    <div ref={coordSectionTopRef} className="space-y-4">
      {/* 안내 */}
      <p className="text-xs leading-relaxed text-slate-400">
        💡 단원들이 가능한 날짜를 고르는 링크를 만들고, 응답 현황을 확인해요.
      </p>

      {/* 만들기 버튼 */}
      <button
        onClick={() => setShowCreate(true)}
        className="sticky bottom-4 z-30 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1a2744] px-4 py-4 text-[15px] font-bold text-white shadow-[0_10px_24px_-10px_rgba(26,39,68,0.5)] transition hover:bg-[#243258] active:scale-[0.99]"
      >
        <PlusIcon className="h-5 w-5" />
        일정방 만들기
      </button>

      {/* 방 목록 */}
      {loading ? (
        <div className="card flex justify-center py-6"><Spinner /></div>
      ) : coords.length === 0 ? (
        <div className="card">
          <EmptyState icon={CalendarIcon} title="아직 만든 일정방이 없어요." hint="위 버튼으로 첫 일정방을 만들어 보세요." />
        </div>
      ) : (
        <div className="space-y-2.5">
          {coords.map((c) => {
            const denom = denomOf(c);
            const n = respCount[c.id] ?? 0;
            const done = c.status === "done";
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(c.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpenId(c.id); }}
                className="card cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)]"
              >
                {/* 제목 + 상태 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{c.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <AudienceBadge coord={c} />
                      {(c.candidateDates ?? []).length > 0 && (
                        <span className="text-[11px] text-slate-400">후보 {(c.candidateDates ?? []).length}일</span>
                      )}
                      <span className="text-[11px] text-slate-300">·</span>
                      <span className="text-[11px] text-slate-400">{c.createdByName}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    done ? "bg-emerald-50 text-emerald-700" : "bg-yellow-50 text-yellow-600"
                  }`}>
                    {done ? "✓ 확정" : <><span className="mr-1 inline-block h-2 w-2 rounded-full bg-yellow-400" />진행 중</>}
                  </span>
                </div>

                {/* 확정 or 진행 현황 */}
                <div className="mt-3">
                  {done && c.confirmedDate ? (
                    <p className="text-sm font-semibold text-slate-700">📅 {fullDateLabel(c.confirmedDate)}</p>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">
                          응답 <b className="text-accent">{n}</b>{denom > 0 ? `/${denom}` : ""}명
                        </span>
                        {denom > 0 && (
                          <span className="font-semibold text-slate-400">
                            {Math.min(100, Math.round((n / denom) * 100))}%
                          </span>
                        )}
                      </div>
                      {denom > 0 && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((n / denom) * 100))}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* 일정방 만들기 */}
      <BottomSheet open={showCreate} title="일정방 만들기" onClose={() => setShowCreate(false)} onConfirm={() => coordCreateRef.current?.()}>
        <CoordCreateForm teams={teams} myTeam={myTeam} onCreate={createCoord} submitRef={coordCreateRef} />
      </BottomSheet>

      {/* 일정방 상세 — 바텀시트 */}
      <BottomSheet
        open={!!openCoord}
        title={openCoord?.title ?? ""}
        onClose={() => { setOpenId(null); loadCoords(); }}
        onConfirm={isParticipantOfOpen && !lockedOpen ? () => coordDetailSaveRef.current?.() : undefined}
      >
        {openCoord && (
          <CoordDetail
            coord={openCoord}
            isAdmin={isAdmin}
            uid={uid}
            myName={myName}
            myAvatar={myAvatar}
            myTeam={myTeam}
            denom={denomOf(openCoord)}
            onClose={() => { setOpenId(null); loadCoords(); }}
            onChanged={loadCoords}
            onConfirmed={onConfirmed}
            onRemove={() => removeCoord(openCoord)}
            saveRef={coordDetailSaveRef}
          />
        )}
      </BottomSheet>

      {/* 만든 직후 확인 시트 */}
      <BottomSheet open={!!createdCoord} onClose={() => setCreatedId(null)}>
        {createdCoord && (
          <div className="space-y-3 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-9 w-9">
                <path d="M4 13l5 5L20 7" />
              </svg>
            </span>
            <div>
              <p className="text-xl font-bold text-slate-900">일정방을 만들었어요</p>
              <p className="mt-1 text-sm text-slate-500">단원들에게 링크를 공유해 가능한 날짜를 받아보세요.</p>
            </div>
            <div className="card text-left">
              <p className="font-bold text-slate-900">{createdCoord.title}</p>
              <p className="mt-1 text-sm text-slate-500">
                후보 날짜 <b className="text-slate-700">{(createdCoord.candidateDates ?? []).length}일</b>
                {createdCoord.team ? ` · 대상 ${createdCoord.team}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                응답 0{denomOf(createdCoord) > 0 ? `/${denomOf(createdCoord)}` : ""}명 · 아직 아무도 응답하지 않았어요
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => shareLink(createdCoord.title, linkOf(createdCoord.id))} className="btn-accent flex-1">
                <ShareIcon className="h-4 w-4" />
                공유하기
              </button>
              <button
                onClick={() => {
                  setCreatedId(null);
                  setOpenId(createdCoord.id);
                }}
                className="btn-ghost"
              >
                방 열기
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

// ---------- 일정방 만들기 폼 (이름 · 대상(팀/개별) · 날짜 후보) ----------
function CoordCreateForm({
  teams,
  myTeam,
  onCreate,
  submitRef,
}: {
  teams: string[];
  myTeam: string;
  onCreate: (fields: {
    title: string;
    location: string;
    team: string;
    participantUids?: string[];
    candidateDates: string[];
    deadline?: number;
  }) => Promise<void>;
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("스튜디오 얼라이브");
  const [audienceMode, setAudienceMode] = useState<"team" | "individual">("team");
  const [team, setTeam] = useState(myTeam);
  const [members, setMembers] = useState<{ uid: string; name: string; avatar?: string; team?: string }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [deadlineDate, setDeadlineDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10, 0, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [deadlineTime, setDeadlineTime] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10, 0, 0);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  // 헤더 ✓ 버튼 등록 (유효성 실패 시 false 반환 → 바텀시트 유지)
  if (submitRef) submitRef.current = () => {
    if (!title.trim()) { alert("일정 이름을 입력해 주세요."); return false; }
    if (audienceMode === "individual" && selectedUids.length === 0) { alert("참여 인원을 한 명 이상 선택해 주세요."); return false; }
    if (dates.length < 2) { alert("후보 날짜를 2개 이상 골라주세요."); return false; }
    void submit();
  };
  const todayStr = toDateStr(new Date());

  const { settings } = useTheme();
  const currentProductionId = settings.currentProductionId ?? "";

  // 개별 선택 모드로 처음 전환할 때만 단원 목록 불러오기
  // → 현재 진행 작품의 참여명단에 있는 인원만 표시
  useEffect(() => {
    if (audienceMode !== "individual" || members.length > 0) return;
    setMembersLoading(true);
    (async () => {
      // 공개 프로필 전체
      const snap = await getDocs(collection(db, "publicProfiles"));
      const all = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }));

      // 현재 진행 작품의 participants 로 필터
      let filtered = all;
      if (currentProductionId) {
        const psnap = await getDoc(doc(db, "productions", currentProductionId));
        const parts = (psnap.data()?.participants as string[] | undefined) ?? [];
        if (parts.length > 0) {
          const partsSet = new Set(parts);
          filtered = all.filter((m) => partsSet.has(m.uid));
        }
      }

      setMembers(filtered.sort((a, b) => a.name.localeCompare(b.name, "ko")));
      setMembersLoading(false);
    })();
  }, [audienceMode, members.length]);

  function toggleMember(uid: string) {
    setSelectedUids((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  }

  function toggleDate(ds: string) {
    setDates((prev) => (prev.includes(ds) ? prev.filter((d) => d !== ds) : [...prev, ds].sort()));
  }

  async function submit() {
    if (!title.trim()) {
      alert("일정 이름을 입력해 주세요.");
      return;
    }
    if (audienceMode === "individual" && selectedUids.length === 0) {
      alert("참여 인원을 한 명 이상 선택해 주세요.");
      return;
    }
    if (dates.length < 2) {
      alert("후보 날짜를 2개 이상 골라주세요.");
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        location: location.trim() || "스튜디오 얼라이브",
        team: audienceMode === "team" ? team : "",
        participantUids: audienceMode === "individual" ? selectedUids : undefined,
        candidateDates: dates,
        ...(deadlineDate && deadlineTime ? { deadline: new Date(`${deadlineDate}T${deadlineTime}`).getTime() } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 일정 이름 + 장소 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 이름" />
        <div className="flex items-center">
          <input
            className="field flex-1 !border-0 !shadow-none"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="장소"
          />
          {location && (
            <button
              type="button"
              onClick={() => setLocation("")}
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

      {/* 참여 인원 (팀 / 개별) */}
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
          <div className="flex flex-wrap gap-1.5">
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
                    onClick={() => toggleMember(m.uid)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50"
                  >
                    <ProfileAvatar uid={m.uid} name={m.name} avatar={m.avatar} className="h-7 w-7 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{m.name}</span>
                    {m.team && <TeamBadge team={m.team} />}
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

      {/* 날짜 후보 */}
      <div className="card">
        <p className="font-bold text-slate-900">날짜 후보</p>
        <p className="mb-3 mt-0.5 text-xs leading-relaxed text-slate-400">
          후보 날짜를 2개 이상 골라주세요. 시간은 단원들이 날짜별로 골라줘요.
        </p>
        <div className="mb-2 flex items-center justify-between">
          <button
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
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            aria-label="다음 달"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            ›
          </button>
        </div>
        <CalendarGrid
          grid={grid}
          renderCell={(d) => {
            const ds = toDateStr(d);
            const on = dates.includes(ds);
            return (
              <button
                onClick={() => toggleDate(ds)}
                className={`flex h-full w-full items-center justify-center rounded-lg text-sm transition ${
                  on ? "bg-accent font-bold text-accent-fg" : "bg-surface text-slate-600 hover:bg-slate-200"
                } ${!on && ds === todayStr ? "ring-1 ring-accent/50" : ""}`}
              >
                {d.getDate()}
              </button>
            );
          }}
        />
        {dates.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-1.5 text-xs font-semibold text-slate-400">선택한 날짜 {dates.length}일</p>
            <div className="flex flex-wrap gap-1.5">
              {dates.map((ds) => (
                <button
                  key={ds}
                  onClick={() => toggleDate(ds)}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition hover:brightness-95"
                >
                  <XIcon className="h-3 w-3" />
                  {dateLabel(ds).md}({dateLabel(ds).dow})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 마감일 */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-4 py-3.5">
          <p className="mb-2 text-xs font-semibold text-slate-500">응답 마감</p>
          {(() => {
            // 날짜 표시 포맷 (YYYY-MM-DD → "YYYY. M. D. (요일)")
            const [y, m, d] = deadlineDate.split("-").map(Number);
            const dt = new Date(y, m - 1, d);
            const dateDisplay = `${y}. ${m}. ${d}. (${WEEKDAYS_KO[dt.getDay()]})`;
            // 시간 표시 포맷 (HH:mm → "오전/오후 H:mm")
            const [h, min] = deadlineTime.split(":").map(Number);
            const isPM = h >= 12;
            const hr = h === 12 ? 12 : h % 12 || 12;
            const timeDisplay = `${isPM ? "오후" : "오전"} ${hr}:${pad(min)}`;
            return (
              <div className="flex items-center gap-2.5">
                <ClockIcon className="h-5 w-5 shrink-0 text-slate-400" />
                {/* 날짜 탭 — 시스템 날짜 피커 */}
                <div className="relative cursor-pointer">
                  <span className="text-[15px] font-medium text-slate-700 underline decoration-dotted underline-offset-2">
                    {dateDisplay}
                  </span>
                  <input
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </div>
                {/* 시간 탭 — 시스템 시간 피커 */}
                <div className="relative cursor-pointer">
                  <span className="text-[15px] font-medium text-slate-700 underline decoration-dotted underline-offset-2">
                    {timeDisplay}
                  </span>
                  <input
                    type="time"
                    value={deadlineTime}
                    onChange={(e) => setDeadlineTime(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </div>

    </div>
  );
}

// ---------- 일정방 상세 ----------
function CoordDetail({
  coord,
  isAdmin,
  uid,
  myName,
  myAvatar,
  myTeam,
  denom,
  onClose,
  onChanged,
  onConfirmed,
  onRemove,
  saveRef,
}: {
  coord: Coordination;
  isAdmin: boolean;
  uid: string;
  myName: string;
  myAvatar: string;
  myTeam: string;
  denom: number;
  onClose: () => void;
  onChanged: () => void;
  onConfirmed: () => void;
  onRemove: () => void;
  saveRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const candidates = useMemo(() => [...(coord.candidateDates ?? [])].sort(), [coord.candidateDates]);
  const closed = !!coord.deadline && Date.now() > coord.deadline;
  const done = coord.status === "done";
  const locked = closed || done;
  // 응답 가능 여부: 개별 지정이면 포함된 uid만, 팀 지정이면 해당 팀만, 전체면 누구나
  const isParticipant = isAdmin || (
    coord.participantUids && coord.participantUids.length > 0
      ? coord.participantUids.includes(uid)
      : !coord.team || !myTeam || coord.team === myTeam
  );

  const [allAvail, setAllAvail] = useState<Availability[]>([]);
  const [myDates, setMyDates] = useState<string[]>([]);
  const [slotsByDate, setSlotsByDate] = useState<Record<string, string[]>>({});
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState<{ date: string; start: string; end: string } | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState(false); // 확정 완료 후 성공 화면
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null); // 타임바 범위 선택 첫 탭

  // 후보 날짜가 있는 달로 달력 시작
  const [cursor, setCursor] = useState(() => {
    const first = [...(coord.candidateDates ?? [])].sort()[0];
    if (first) {
      const [y, m] = first.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const grid = useMemo(() => buildMonthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const loadAll = useCallback(async () => {
    const snap = await getDocs(collection(db, "coordinations", coord.id, "availability"));
    setAllAvail(snap.docs.map((d) => d.data() as Availability));
  }, [coord.id]);

  const loadMine = useCallback(async () => {
    if (!uid) return;
    const snap = await getDoc(doc(db, "coordinations", coord.id, "availability", uid));
    if (snap.exists()) {
      const a = snap.data() as Availability;
      setMyDates([...(a.dates ?? [])].sort());
      setSlotsByDate(a.slots ?? {});
    } else {
      setMyDates([]);
      setSlotsByDate({});
    }
    setDirty(false);
  }, [coord.id, uid]);

  useEffect(() => {
    loadAll();
    loadMine();
  }, [loadAll, loadMine]);

  // 날짜 바뀌면 타임바 범위선택 앵커 초기화
  useEffect(() => { setRangeAnchor(null); }, [activeDate]);

  // ----- 집계 -----
  const submitters = allAvail.length;
  const dateCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of allAvail) for (const ds of a.dates ?? []) m[ds] = (m[ds] ?? 0) + 1;
    return m;
  }, [allAvail]);
  const maxDateCount = useMemo(() => Math.max(0, ...Object.values(dateCount)), [dateCount]);

  const slotCount = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const a of allAvail) {
      for (const date of a.dates ?? []) {
        const specific = a.slots?.[date];
        const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
        m[date] ??= {};
        for (const s of list) m[date][s] = (m[date][s] ?? 0) + 1;
      }
    }
    return m;
  }, [allAvail]);

  const bestRangeForDate = useCallback(
    (date: string): { start: string; end: string; count: number } | null => {
      const counts = TIME_SLOTS.map((s) => slotCount[date]?.[s] ?? 0);
      const maxC = Math.max(...counts, 0);
      if (maxC <= 0) return null;
      let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] === maxC) {
          if (curStart < 0) curStart = i;
          curLen++;
          if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else { curStart = -1; curLen = 0; }
      }
      return { start: TIME_SLOTS[bestStart], end: slotEnd(TIME_SLOTS[bestStart + bestLen - 1]), count: maxC };
    },
    [slotCount]
  );

  const membersForActive = useMemo(() => {
    if (!activeDate) return [];
    const map = new Map<string, { uid: string; name: string; avatar?: string }>();
    for (const a of allAvail) {
      if ((a.dates ?? []).includes(activeDate)) {
        const avatar = a.uid === uid ? myAvatar || a.avatar : a.avatar;
        map.set(a.uid, { uid: a.uid, name: a.name || "이름없음", avatar });
      }
    }
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, "ko"));
  }, [activeDate, allAvail, uid, myAvatar]);

  const othersBySlot = useMemo(() => {
    const m: Record<string, number> = {};
    if (!activeDate) return m;
    for (const a of allAvail) {
      if (a.uid === uid) continue;
      if (!(a.dates ?? []).includes(activeDate)) continue;
      const specific = a.slots?.[activeDate];
      const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
      for (const s of list) m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [activeDate, allAvail, uid]);

  // ----- 내 가능 날짜 편집 (후보 날짜 중에서만) -----
  function toggleMyDate(ds: string) {
    if (locked || !isParticipant || !candidates.includes(ds)) return;
    setMyDates((prev) => (prev.includes(ds) ? prev.filter((d) => d !== ds) : [...prev, ds].sort()));
    setSlotsByDate((s) => {
      if (!myDates.includes(ds)) return s;
      const n = { ...s };
      delete n[ds];
      return n;
    });
    setDirty(true);
  }

  // 타임바 범위 선택: 1탭=시작, 2탭=끝(채우기+리셋), 3탭=전체초기화+새시작, 4탭=끝(채우기+리셋) …
  function tapSlot(slot: string) {
    if (!activeDate || locked || !isParticipant) return;
    if (rangeAnchor === null) {
      // 홀수 탭: 슬롯 전체 초기화 후 시작점 설정
      setSlotsByDate((prev) => ({ ...prev, [activeDate]: [] }));
      setRangeAnchor(slot);
    } else {
      // 짝수 탭: 앵커~현재 사이 채우고 앵커 초기화
      const iA = TIME_SLOTS.indexOf(rangeAnchor);
      const iB = TIME_SLOTS.indexOf(slot);
      const [lo, hi] = iA <= iB ? [iA, iB] : [iB, iA];
      const range = TIME_SLOTS.slice(lo, hi + 1);
      setSlotsByDate((prev) => {
        const cur = new Set(prev[activeDate] ?? []);
        range.forEach((s) => cur.add(s));
        return { ...prev, [activeDate]: [...cur].sort() };
      });
      if (!myDates.includes(activeDate)) setMyDates((prev) => [...prev, activeDate].sort());
      setDirty(true);
      setRangeAnchor(null);
    }
  }

  // 해제: 현재 날짜 시간 슬롯 전부 초기화 (날짜 가능 표시는 유지 = 아무때나 가능)
  function clearSlots() {
    if (!activeDate || locked || !isParticipant) return;
    setSlotsByDate((prev) => ({ ...prev, [activeDate]: [] }));
    setRangeAnchor(null);
    setDirty(true);
  }

  async function saveMine() {
    if (!uid) return;
    setSaving(true);
    try {
      const cleanedSlots: Record<string, string[]> = {};
      for (const d of myDates) {
        const arr = slotsByDate[d];
        if (arr && arr.length > 0) cleanedSlots[d] = arr;
      }
      if (myDates.length === 0) {
        await deleteDoc(doc(db, "coordinations", coord.id, "availability", uid));
      } else {
        await setDoc(doc(db, "coordinations", coord.id, "availability", uid), {
          uid,
          name: myName,
          avatar: myAvatar,
          team: myTeam,
          dates: myDates,
          slots: cleanedSlots,
          updatedAt: Date.now(),
        });
      }
      setDirty(false);
      await loadAll();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/schedule?tab=coord&room=${coord.id}`;
  const pct = denom > 0 ? Math.min(100, Math.round((submitters / denom) * 100)) : submitters > 0 ? 100 : 0;
  const remain = denom > 0 ? Math.max(0, denom - submitters) : 0;

  // 바텀시트 ✓ 버튼에 saveMine 연결
  if (saveRef) saveRef.current = () => { void saveMine(); };

  // 확정까지 걸린 시간
  const elapsed = (() => {
    if (!coord.confirmedAt) return "";
    const ms = Math.max(0, coord.confirmedAt - coord.createdAt);
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return `${d}일 ${h}시간 만에 일정 확정`;
  })();

  return (
    <div className="space-y-4">
      {/* 상태 + 공유·삭제 액션 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold ${done ? "text-emerald-600" : closed ? "text-slate-400" : "text-yellow-500"}`}>
            {done ? "✓ 확정됨" : closed ? "응답 마감" : <><span className="mr-1 inline-block h-2 w-2 rounded-full bg-yellow-400" />진행 중</>}
          </span>
          <AudienceBadge coord={coord} />
        </div>
        <button
          onClick={() => shareLink(coord.title, link)}
          aria-label="링크 공유"
          className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-accent-soft hover:text-accent"
        >
          <ShareIcon className="h-4 w-4" />
        </button>
      </div>

      {/* 확정 완료 카드 */}
      {done && coord.confirmedDate ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-10px_rgba(16,24,40,0.12)]">
          <div className="bg-accent p-6 text-center text-accent-fg">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold opacity-90">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs">✓</span>
              일정 확정 완료
            </p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight">
              {Number(coord.confirmedDate.slice(5, 7))}월 {Number(coord.confirmedDate.slice(8, 10))}일
            </p>
            <p className="mt-1 text-sm opacity-90">
              {WEEKDAYS_KO[new Date(coord.confirmedDate + "T00:00:00").getDay()]}요일
              {coord.confirmedStart ? ` · ${coord.confirmedStart}${coord.confirmedEnd ? `~${coord.confirmedEnd}` : ""}` : ""}
            </p>
            <p className="mt-0.5 text-xs opacity-75">
              {dateCount[coord.confirmedDate] ?? 0}
              {denom > 0 ? `/${denom}` : ""}명 가능
            </p>
          </div>
          <div className="space-y-3 p-4">
            {membersForActive.length === 0 && (dateCount[coord.confirmedDate] ?? 0) > 0 && (
              <p className="text-center text-xs text-slate-400">참석 가능 {dateCount[coord.confirmedDate]}명</p>
            )}
            {elapsed && <p className="text-center text-sm font-semibold text-accent">{elapsed}</p>}
            <button onClick={() => shareLink(coord.title, link)} className="btn-accent w-full">
              <ShareIcon className="h-4 w-4" />
              확정 링크 공유
            </button>
            {isAdmin && (
              <button
                onClick={() => setConfirmDraft({ date: coord.confirmedDate!, start: coord.confirmedStart ?? "", end: coord.confirmedEnd ?? "" })}
                className="btn-ghost w-full"
              >
                확정일 변경
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* 응답 진행 — 방장만 */}
          {coord.createdBy === uid && <div className="card space-y-2.5">
            <p className="font-bold text-slate-900">
              {denom > 0 && remain > 0
                ? remain === 1
                  ? "결과 완성까지 한 명 남았어요"
                  : `결과 완성까지 ${remain}명 남았어요`
                : submitters > 0
                  ? "모든 단원이 응답했어요"
                  : "단원들의 응답을 기다리고 있어요"}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>응답 완료 <b className="text-accent">{submitters}</b>{denom > 0 ? `/${denom}` : ""}명</span>
              <span className="text-slate-400">
                {maxDateCount > 0 ? `현재 최고 후보 ${maxDateCount}명` : "아직 응답 없음"}
              </span>
            </div>
            {coord.deadline && (
              <p className="text-[11px] text-slate-400">{closed ? "응답이 마감됐어요" : `${deadlineLabel(coord.deadline)} 마감`}</p>
            )}
          </div>}

        </>
      )}

      {/* 날짜별 현황 (히트맵) */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">날짜별 현황</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
              aria-label="이전 달"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              ‹
            </button>
            <span className="min-w-[84px] text-center text-sm font-semibold text-slate-700">
              {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
            </span>
            <button
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
              aria-label="다음 달"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              ›
            </button>
          </div>
        </div>
        <CalendarGrid
          grid={grid}
          renderCell={(d) => {
            const ds = toDateStr(d);
            const isCandidate = candidates.includes(ds);
            const cnt = dateCount[ds] ?? 0;
            const active = activeDate === ds;
            const isConfirmed = done && coord.confirmedDate === ds;
            if (!isCandidate) {
              return <div className="flex h-full w-full items-center justify-center text-[13px] text-slate-300">{d.getDate()}</div>;
            }
            const mine = myDates.includes(ds);
            return (
              <div className="relative h-full w-full">
                <button
                  onClick={() => {
                    if (locked || !isParticipant) { setActiveDate(active ? null : ds); return; }
                    if (active) {
                      // 두 번째 탭: 패널 닫기 + 가능 해제
                      setActiveDate(null);
                      setMyDates((prev) => prev.filter((d) => d !== ds));
                      setSlotsByDate((s) => { const n = { ...s }; delete n[ds]; return n; });
                      setDirty(true);
                    } else {
                      // 첫 번째 탭: 패널 열기 + 가능으로 표시
                      setActiveDate(ds);
                      if (!myDates.includes(ds)) {
                        setMyDates((prev) => [...prev, ds].sort());
                        setDirty(true);
                      }
                    }
                  }}
                  style={isConfirmed ? undefined : mine ? undefined : redBorderHeatStyle(cnt, denom, maxDateCount)}
                  className={`relative flex h-full w-full flex-col items-center justify-center rounded-lg border text-[13px] leading-none transition ${
                    isConfirmed
                      ? "border-transparent bg-accent font-bold text-accent-fg"
                      : mine
                        ? "border-transparent bg-[#faf7f2] font-bold text-accent"
                        : cnt > 0
                          ? "font-semibold text-slate-800"
                          : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-200"
                  } ${active && !isConfirmed ? "ring-2 ring-accent" : mine ? "ring-2 ring-accent" : ""}`}
                >
                  <span>{d.getDate()}</span>
                  {/* 인원수 자리: mine이면 체크 배지, 아니면 인원 수 */}
                  {mine && !isConfirmed ? (
                    <span className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent">
                      <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-2 w-2 text-accent-fg">
                        <path d="M1.5 5l2.5 2.5 4.5-4" />
                      </svg>
                    </span>
                  ) : (
                    <span className={`mt-0.5 text-[9px] font-bold ${isConfirmed ? "opacity-90" : cnt > 0 ? "text-slate-500" : "text-slate-400"}`}>
                      {cnt}
                      {denom > 0 ? `/${denom}` : ""}
                    </span>
                  )}
                </button>
              </div>
            );
          }}
        />
        {(locked || !isParticipant) && (
          <p className="mt-3 text-xs text-slate-400">
            {locked ? "응답이 마감된 일정방이에요." : "이 일정방의 응답 대상이 아니에요."}
          </p>
        )}

        {/* 선택한 날짜 — 달력 카드 하단에 인라인으로 표시 */}
        {activeDate && (() => {
          const cnt = dateCount[activeDate] ?? 0;
          const best = bestRangeForDate(activeDate);
          const mine = myDates.includes(activeDate);
          return (
            <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400">선택한 날짜</p>
                  <p className="font-bold text-slate-900">{fullDateLabel(activeDate)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  {cnt}
                  {denom > 0 ? `/${denom}` : ""}명 가능
                </span>
              </div>

              {!locked && isParticipant && mine && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-end gap-2">
                    {rangeAnchor && (
                      <span className="text-[11px] font-semibold text-accent">시작점 선택됨 · 끝 시간 탭하세요</span>
                    )}
                    <button
                      onClick={clearSlots}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50"
                    >
                      해제
                    </button>
                  </div>
                  <TimeRangeBar
                    mySlots={slotsByDate[activeDate] ?? []}
                    othersBySlot={othersBySlot}
                    denom={denom}
                    maxDateCount={maxDateCount}
                    anchor={rangeAnchor}
                    onTap={tapSlot}
                    locked={locked}
                  />
                  <p className="mt-2 text-[11px] text-slate-400">⏰ 비워두면 모두가능으로 표시돼요.</p>
                </div>
              )}

              {best && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-400">가장 겹치는 시간</p>
                  <p className="mt-0.5 text-[17px] font-bold text-slate-800">{best.start}~{best.end} <span className="text-sm font-semibold text-slate-400">{best.count}명</span></p>
                </div>
              )}

              {membersForActive.length > 0 ? (
                <div className={best ? "" : "border-t border-slate-100 pt-3"}>
                  <p className="mb-2 text-xs font-semibold text-slate-500">가능한 단원 {membersForActive.length}명</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {membersForActive.map((m) => (
                      <div key={m.uid} className="flex items-center gap-2">
                        <ProfileAvatar uid={m.uid} name={m.name} avatar={m.avatar} className="h-7 w-7 text-xs" />
                        <span className="text-sm text-slate-700">{m.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                !mine && <p className="text-sm text-slate-400">이 날 가능한 단원이 아직 없어요.</p>
              )}

              {/* 내 일정 저장하기 버튼 */}
              {!locked && isParticipant && (
                <div className="border-t border-slate-100 pt-3">
                  <button
                    onClick={() => void saveMine()}
                    className="w-full rounded-xl bg-[#1a2744] py-2.5 text-sm font-bold text-white transition hover:bg-[#243258] active:scale-[0.98]"
                  >
                    내 일정 저장하기
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 일정 확정 (방장만) */}
      {coord.createdBy === uid && !done && (
        <div className="card space-y-2">
          <p className="font-bold text-slate-900">일정 확정</p>
          <p className="text-sm text-slate-400">
            {activeDate ? fullDateLabel(activeDate) : "위 달력에서 확정할 날짜를 골라주세요."}
          </p>
          <button
            onClick={() => {
              if (!activeDate) return;
              const best = bestRangeForDate(activeDate);
              setConfirmDraft({ date: activeDate, start: best?.start ?? "", end: best?.end ?? "" });
            }}
            disabled={!activeDate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a2744] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#243258] disabled:opacity-40"
          >
            <CalendarIcon className="h-4 w-4" />
            이 날짜로 확정하기
          </button>
        </div>
      )}

      {locked && (
        <p className="rounded-xl bg-surface px-3 py-3 text-center text-xs text-slate-400">
          {done ? "확정된 일정이라 가능 날짜를 수정할 수 없어요." : "응답이 마감돼 가능 날짜를 수정할 수 없어요."}
        </p>
      )}

      {/* 삭제 버튼 */}
      {(isAdmin || coord.createdBy === uid) && (
        <button
          onClick={onRemove}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-red-50"
        >
          <TrashIcon className="h-5 w-5 shrink-0 text-red-400" />
          <span className="text-[15px] text-red-500">일정방 삭제</span>
        </button>
      )}

      {/* 확정 확인 바텀시트 */}
      <BottomSheet
        open={!!confirmDraft}
        title={confirmSuccess ? "확정 완료 🎉" : "이 일정으로 확정할까요?"}
        onClose={() => { setConfirmDraft(null); setConfirmSuccess(false); }}
      >
        {confirmDraft && (
          <ConfirmSheet
            coord={coord}
            draft={confirmDraft}
            onDraftChange={(d) => setConfirmDraft(d)}
            onSuccess={async (start, end) => {
              const eventData = {
                title: coord.title,
                date: confirmDraft.date,
                startTime: start,
                endTime: end,
                location: coord.location || "스튜디오 얼라이브",
                memo: "",
                team: coord.team ?? "",
              };
              // 1) events 컬렉션 — 기존 이벤트 있으면 update, 없으면 신규 생성
              let eventId = coord.confirmedEventId ?? "";
              if (eventId) {
                await updateDoc(doc(db, "events", eventId), eventData).catch(() => {
                  eventId = ""; // 문서가 없으면 새로 생성
                });
              }
              if (!eventId) {
                eventId = crypto.randomUUID();
                await setDoc(doc(db, "events", eventId), { ...eventData, createdAt: Date.now() });
              }
              // 2) 일정방 상태 → done + confirmedEventId 저장
              await updateDoc(doc(db, "coordinations", coord.id), {
                status: "done",
                confirmedDate: confirmDraft.date,
                confirmedStart: start,
                confirmedEnd: end,
                confirmedAt: Date.now(),
                confirmedEventId: eventId,
              }).catch(() => {});
              onChanged();
              onConfirmed();
              setConfirmSuccess(true);
            }}
            onNo={() => { setConfirmDraft(null); setConfirmSuccess(false); onClose(); }}
            success={confirmSuccess}
            onDone={() => { setConfirmDraft(null); setConfirmSuccess(false); onClose(); }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

/* =========================================================================
   확정 확인 시트 내용
   ========================================================================= */
const NAVER_BOOKING_URL = "https://m.booking.naver.com/booking/10/bizes/1715363/items/7953786?";

function ConfirmSheet({
  coord,
  draft,
  onDraftChange,
  onSuccess,
  onNo,
  success,
  onDone,
}: {
  coord: Coordination;
  draft: { date: string; start: string; end: string };
  onDraftChange: (d: { date: string; start: string; end: string }) => void;
  onSuccess: (start: string, end: string) => Promise<void>;
  onNo: () => void;
  success: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // 대상 텍스트
  const audienceLabel = coord.participantUids && coord.participantUids.length > 0
    ? `${coord.participantUids.length}명 개별 지정`
    : coord.team || "전체";

  async function handleYes() {
    setBusy(true);
    try { await onSuccess(draft.start, draft.end); }
    finally { setBusy(false); }
  }

  function openNaver() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) window.location.href = NAVER_BOOKING_URL;
    else window.open(NAVER_BOOKING_URL, "_blank", "noopener,noreferrer");
  }

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10">
            <path d="M4 13l5 5L20 7" />
          </svg>
        </span>
        <div>
          <p className="text-xl font-bold text-slate-900">이 일정으로 확정되었습니다!</p>
          <p className="mt-1 text-sm text-slate-500">
            {fullDateLabel(draft.date)}
            {draft.start ? ` · ${draft.start}${draft.end ? `~${draft.end}` : ""}` : ""}
          </p>
        </div>
        <div className="card text-left space-y-1.5">
          <InfoRow label="대상" value={audienceLabel} />
          <InfoRow label="장소" value={coord.location || "스튜디오 얼라이브"} />
        </div>
        <div className="flex gap-2">
          <button
            onClick={openNaver}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold text-white transition active:brightness-90"
            style={{ backgroundColor: "#03C75A", boxShadow: "0 8px 20px -6px rgba(3,199,90,0.55)" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>
            </svg>
            예약하기
          </button>
          <button
            onClick={onDone}
            className="flex-1 rounded-2xl border border-slate-200 py-3.5 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 정보 */}
      <div className="card space-y-2">
        <InfoRow label="대상" value={audienceLabel} />
        <InfoRow label="장소" value={coord.location || "스튜디오 얼라이브"} />
        <InfoRow label="날짜" value={fullDateLabel(draft.date)} />
      </div>

      {/* 시간 (편집 가능) */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">시작</span>
          <input
            type="time"
            value={draft.start}
            onChange={(e) => onDraftChange({ ...draft, start: e.target.value })}
            className="field-chip"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-medium text-slate-700">종료</span>
          <input
            type="time"
            value={draft.end}
            onChange={(e) => onDraftChange({ ...draft, end: e.target.value })}
            className="field-chip"
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 px-1">⏰ 가장 겹치는 시간이 자동으로 설정됐어요. 필요하면 변경하세요.</p>

      {/* 네 / 아니오 */}
      <div className="flex gap-2">
        <button
          onClick={handleYes}
          disabled={busy}
          className="flex-1 rounded-2xl bg-[#1a2744] py-3.5 text-[15px] font-bold text-white transition hover:bg-[#243258] disabled:opacity-60"
        >
          {busy ? "처리 중…" : "네, 확정할게요"}
        </button>
        <button
          onClick={onNo}
          className="flex-1 rounded-2xl border border-slate-200 py-3.5 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          아니오
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-10 shrink-0 text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-[15px] font-medium text-slate-800">{value}</span>
    </div>
  );
}

/* =========================================================================
   확정 일정 (지난 일정도 흐리게 함께 표시)
   ========================================================================= */

function EventsSection({
  monthLabel,
  onPrev,
  onNext,
  yearMonth,
  events,
  isAdmin,
  onChanged,
  highlightId,
  highlightDate,
  teams,
  myTeam,
  openNew = false,
  onNewHandled,
}: {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  yearMonth: string;
  events: ScheduleEvent[];
  isAdmin: boolean;
  onChanged: () => void;
  highlightId?: string | null;
  highlightDate?: string | null;
  teams: string[];
  myTeam: string;
  openNew?: boolean;
  onNewHandled?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null);
  // 초기 진입 시: highlightDate가 있으면 그 날짜 선택, 없으면 오늘(이번 달이면)
  const todayStr = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    if (highlightDate && highlightDate.slice(0, 7) === yearMonth) return highlightDate;
    return yearMonth === todayStr.slice(0, 7) ? todayStr : null;
  });
  useEffect(() => {
    setSelectedDate(yearMonth === todayStr.slice(0, 7) ? todayStr : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearMonth]);

  // 일정 목록 페이드 애니메이션 — key 변경으로 리마운트 + CSS keyframe 동시 페이드

  const newEventRef = useRef<(() => void) | null>(null);
  const editEventRef = useRef<(() => void) | null>(null);
  // 달력 그리드
  const [ym_year, ym_month] = yearMonth.split("-").map(Number);
  const miniGrid = useMemo(() => buildMonthGrid(ym_year, ym_month - 1), [ym_year, ym_month]);
  // 폼 기본값 (날짜 + 현재시각/1시간뒤)
  const [formDate, setFormDate] = useState(`${yearMonth}-01`);
  const [formTimes, setFormTimes] = useState({ startTime: "", endTime: "" });

  function openNewForm(date: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const st = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const later = new Date(now.getTime() + 3600000);
    const et = `${pad(later.getHours())}:${pad(later.getMinutes())}`;
    setFormDate(date);
    setFormTimes({ startTime: st, endTime: et });
    setShowForm(true);
  }

  useEffect(() => {
    if (openNew && isAdmin) {
      openNewForm(`${yearMonth}-01`);
      onNewHandled?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew, isAdmin]);

  // 팀 필터 (기본: 전체). 빈값이면 전체
  const [evTeam, setEvTeam] = useState("");
  const visibleEvents = events.filter((e) => {
    // 숨겨진 일정: 관리자만 볼 수 있음
    if (e.hidden && !isAdmin) return false;
    if (teams.length === 0 || !evTeam) return true; // 전체 보기
    if (e.source === 'naver') return false;          // 네이버 예약은 팀 필터 시 숨김
    return !e.team || e.team === evTeam;
  });

  const [absences, setAbsences] = useState<Record<string, Absence[]>>({});
  const loadAbsences = useCallback(async () => {
    // 불참 의견은 '아직 안 지난 일정'만 필요 → 지난 일정은 조회 생략(읽기 절감)
    const upcoming = events.filter((e) => !eventPassed(e));
    const entries = await Promise.all(
      upcoming.map(async (e) => {
        const snap = await getDocs(collection(db, "events", e.id, "absences"));
        return [e.id, snap.docs.map((d) => d.data() as Absence)] as const;
      })
    );
    setAbsences(Object.fromEntries(entries));
  }, [events]);
  useEffect(() => {
    loadAbsences();
  }, [loadAbsences]);

  useEffect(() => {
    if (highlightId) {
      const el = document.getElementById(`ev-${highlightId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId, events]);

  async function removeEvent(id: string) {
    if (!confirm("이 일정을 삭제할까요?")) return;
    await deleteDoc(doc(db, "events", id));
    setEditEvent(null);
    onChanged();
  }

  async function toggleHide(e: ScheduleEvent) {
    await updateDoc(doc(db, "events", e.id), { hidden: !e.hidden });
    setEditEvent(null);
    onChanged();
  }

  // 날짜순(그 달 흐름대로)
  const sortedEvents = [...visibleEvents].sort((a, b) =>
    (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || ""))
  );

  // 날짜별로 묶기 (왼쪽 날짜 1개 + 그 날 일정 카드들)
  const groups: [string, ScheduleEvent[]][] = [];
  for (const e of sortedEvents) {
    const last = groups[groups.length - 1];
    if (last && last[0] === e.date) last[1].push(e);
    else groups.push([e.date, [e]]);
  }

  return (
    <div className="space-y-4">
      {/* 헤더: 월 이동 + 네이버 예약 버튼 */}
      <div className="flex items-center gap-1">
        <button onClick={onPrev} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
        <span className="text-lg font-bold text-slate-900">{monthLabel}</span>
        <button onClick={onNext} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
        <div className="flex-1" />
        <button
          onClick={() => {
            const BOOKING_URL = "https://m.booking.naver.com/booking/10/bizes/1715363/items/7953786?";
            // 모바일: window.location으로 이동하면 OS가 네이버 앱 Universal Link 감지 → 앱 자동 실행
            // 데스크탑: 새 탭으로 fallback
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            if (isMobile) {
              window.location.href = BOOKING_URL;
            } else {
              window.open(BOOKING_URL, "_blank", "noopener,noreferrer");
            }
          }}
          className="flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold leading-none text-white transition active:brightness-90"
          style={{ backgroundColor: "#03C75A" }}
        >
          {/* 네이버 N 아이콘 */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>
          </svg>
          예약하기
        </button>
      </div>

      {/* 팀 필터 */}
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {([["", "전체"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => {
            const isAll = val === "";
            const teamC = !isAll ? getTeamColor(val, teams) : null;
            const isActive = evTeam === val;
            let chipStyle: React.CSSProperties = {};
            let chipClass = "rounded-full border px-2.5 py-1 text-xs font-medium transition ";
            if (isAll) {
              chipClass += isActive
                ? "border-accent bg-accent-soft text-accent"
                : "border-slate-200 text-slate-500 hover:bg-slate-50";
            } else if (teamC) {
              if (isActive) {
                chipStyle = { borderColor: teamC.border, backgroundColor: teamC.bg, color: teamC.color };
              } else {
                chipClass += "border-slate-200 text-slate-500 hover:bg-slate-50";
              }
            } else {
              chipClass += isActive
                ? "border-accent bg-accent-soft text-accent"
                : "border-slate-200 text-slate-500 hover:bg-slate-50";
            }
            return (
              <button
                key={val || "all"}
                onClick={() => setEvTeam(val)}
                style={chipStyle}
                className={chipClass}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <BottomSheet open={showForm} title="확정 일정 등록" onClose={() => setShowForm(false)} onConfirm={() => newEventRef.current?.()}>
          <EventForm
            key={`${formDate}-${formTimes.startTime}`}
            initial={{ date: formDate, startTime: formTimes.startTime, endTime: formTimes.endTime }}
            onSaved={() => { setShowForm(false); onChanged(); }}
            onCancel={() => setShowForm(false)}
            submitRef={newEventRef}
          />
        </BottomSheet>
      )}

      {/* 풀 캘린더 */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
          {WEEKDAYS_KO.map((w) => (
            <div key={w} className="py-2.5 text-center text-[12px] font-bold text-slate-400">{w}</div>
          ))}
        </div>
        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {miniGrid.map((d, i) => {
            if (!d) return <div key={i} className="min-h-[80px] border-t border-slate-100" />;
            const ds = toDateStr(d);
            const isToday = ds === todayStr;
            const isSelected = ds === selectedDate;
            const dow = d.getDay(); // 0=일, 6=토
            const dayEvents = visibleEvents.filter((e) => e.date === ds);
            // 날짜 숫자 컬러: 주말은 연하게
            const baseColor = dow === 0 || dow === 6 ? "text-slate-400" : "text-slate-700";
            return (
              <div
                key={i}
                onClick={() => {
                  if (isSelected) {
                    if (isAdmin) { openNewForm(ds); }
                    setSelectedDate(null);
                  } else {
                    setSelectedDate(ds);
                    if (dayEvents.length > 0) {
                      setTimeout(() => {
                        const firstId = dayEvents[0]?.id;
                        if (firstId) document.getElementById(`ev-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 60);
                    }
                  }
                }}
                className="relative min-h-[80px] cursor-pointer border-t border-slate-100 p-1.5 transition"
              >
                {/* 날짜 숫자: 원 배경 분리 → 스케일 애니메이션 */}
                <div className="relative mb-1.5 mx-auto h-7 w-7">
                  {/* 원 배경: 항상 DOM에 있고 scale로 show/hide */}
                  <div className={`absolute inset-0 origin-center rounded-full transition-transform duration-200 ease-out ${
                    isSelected
                      ? isToday ? "bg-accent scale-100" : "bg-[#1a2744] scale-100"
                      : "scale-0 " + (isToday ? "bg-accent" : "bg-[#1a2744]")
                  }`} />
                  {/* 숫자 */}
                  <div className={`relative flex h-full w-full items-center justify-center text-[15px] ${
                    isSelected
                      ? "font-bold text-white"
                      : isToday
                        ? "font-normal text-accent"
                        : `font-bold ${baseColor}`
                  }`}>
                    {d.getDate()}
                  </div>
                </div>
                {/* 이벤트 칩 */}
                <div className="space-y-px">
                  {dayEvents.slice(0, 4).map((e) => {
                    const passed = eventPassed(e);
                    const isHidden = !!e.hidden; // 관리자에게만 보임 (여기까지 오면 관리자)
                    const tc = (!passed && !isHidden) ? getEventColor(e, teams) : null;
                    const barColor = (passed || isHidden) ? "#cbd5e1" : tc?.border ?? "rgb(var(--accent))";
                    return (
                      <div
                        key={e.id}
                        className={`flex items-center gap-[2px] overflow-hidden rounded-sm ${
                          (passed || isHidden) ? "bg-slate-100" : tc ? "" : "bg-accent-soft"
                        }`}
                        style={tc && !passed && !isHidden ? { backgroundColor: tc.bg, color: tc.color } : undefined}
                      >
                        {/* 컬러바 — 칩 전체 높이 */}
                        <div
                          className="w-[3px] shrink-0 self-stretch rounded-full"
                          style={{ backgroundColor: barColor }}
                        />
                        {/* 제목 — 우측 페이드 마스크 */}
                        <span
                          className={`min-w-0 flex-1 whitespace-nowrap py-px text-[9px] font-semibold leading-[13px] ${
                            (passed || isHidden) ? "text-slate-400 line-through" : tc ? "" : "text-accent"
                          }`}
                          style={{
                            ...(tc && !passed && !isHidden ? { color: tc.color } : {}),
                            maskImage: "linear-gradient(to right, black 55%, transparent 95%)",
                            WebkitMaskImage: "linear-gradient(to right, black 55%, transparent 95%)",
                          }}
                        >
                          {e.title}
                        </span>
                      </div>
                    );
                  })}
                  {dayEvents.length > 4 && (
                    <div className="px-0.5 text-[9px] font-medium text-slate-400">+{dayEvents.length - 4}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 수정 BottomSheet (카드 클릭으로 열림) */}
      {isAdmin && (
        <BottomSheet open={!!editEvent} title="확정 일정 수정" onClose={() => setEditEvent(null)} onConfirm={() => editEventRef.current?.()}>
          {editEvent && (
            <>
              <EventForm
                key={editEvent.id}
                eventId={editEvent.id}
                initial={{ date: editEvent.date, startTime: editEvent.startTime, endTime: editEvent.endTime, title: editEvent.title, team: editEvent.team, location: editEvent.location, memo: editEvent.memo }}
                onSaved={() => { setEditEvent(null); onChanged(); }}
                onCancel={() => setEditEvent(null)}
                submitRef={editEventRef}
              />
              <div className="mt-4 border-t border-slate-100 pt-3 space-y-1">
                <button
                  onClick={() => toggleHide(editEvent)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                >
                  {editEvent.hidden
                    ? <EyeIcon className="h-5 w-5 shrink-0 text-slate-400" />
                    : <EyeOffIcon className="h-5 w-5 shrink-0 text-slate-400" />
                  }
                  <span className="text-[15px] text-slate-600">
                    {editEvent.hidden ? "숨기기 해제" : "일정 숨기기"}
                  </span>
                </button>
                <button
                  onClick={() => removeEvent(editEvent.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-red-50"
                >
                  <TrashIcon className="h-5 w-5 shrink-0 text-red-400" />
                  <span className="text-[15px] text-red-500">일정 삭제</span>
                </button>
              </div>
            </>
          )}
        </BottomSheet>
      )}

      {/* 일정 리스트 — selectedDate 기준 렌더링 + CSS keyframe 동시 페이드 */}
      {(() => {
        const displayGroups = selectedDate
          ? groups.filter(([date]) => date === selectedDate)
          : groups;

        if (visibleEvents.length === 0) {
          return (
            <EmptyState
              icon={CalendarIcon}
              title={teams.length > 0 && evTeam ? `${evTeam} 확정 일정이 없습니다.` : "이번 달 확정 일정이 없습니다."}
            />
          );
        }

        const cardList = selectedDate && displayGroups.length === 0 ? null : (
          <div key={selectedDate ?? "all"} className="space-y-2 animate-list-fade-in">
            {displayGroups.map(([date, evs]) => (
              evs.map((e) => {
                const past = eventPassed(e);
                const isHidden = !!e.hidden;
                const dimmed = past || isHidden;
                const barColor = dimmed
                  ? "#cbd5e1"
                  : getEventColor(e, teams)?.border ?? "rgb(var(--accent))";
                return (
                  <div
                    key={e.id}
                    id={`ev-${e.id}`}
                    onClick={() => { if (isAdmin) setEditEvent(e); }}
                    className={`flex items-center overflow-hidden rounded-2xl bg-white shadow-sm transition ${
                      highlightId === e.id ? "ring-2 ring-accent" : ""
                    } ${dimmed ? "opacity-50" : ""} ${isAdmin ? "cursor-pointer hover:shadow-md" : ""}`}
                  >
                    {/* 시간 */}
                    <div className="flex w-[72px] shrink-0 flex-col justify-center pl-3 pr-3 py-3">
                      {(() => {
                        const sp = formatTimeParts(e.startTime);
                        return (
                          <p className={`whitespace-nowrap tracking-tighter text-[17px] font-bold leading-tight ${isHidden ? "text-slate-400 line-through" : "text-slate-900"}`}>
                            {sp.time}<span className="ml-[3px] text-[10px] font-semibold tracking-normal">{sp.ampm}</span>
                          </p>
                        );
                      })()}
                      {e.endTime && (() => {
                        const ep = formatTimeParts(e.endTime);
                        return (
                          <p className="mt-0.5 whitespace-nowrap tracking-tighter text-[12px] font-medium text-slate-400">
                            {ep.time}<span className="ml-[3px] text-[9px] tracking-normal">{ep.ampm}</span>
                          </p>
                        );
                      })()}
                    </div>
                    {/* 컬러 바: 세로 여백 + 둥근 모서리 */}
                    <div className="self-stretch flex py-3">
                      <div className="w-[4px] flex-1 rounded-full" style={{ backgroundColor: barColor }} />
                    </div>
                    {/* 내용 */}
                    <div className="min-w-0 flex-1 py-3 pl-3 pr-3">
                      <p className="flex items-center gap-1.5 text-[17px] font-bold tracking-tighter text-slate-900">
                        <TeamBadge team={e.team} />
                        <span className={`min-w-0 truncate ${isHidden ? "line-through text-slate-400" : ""}`}>{e.title}</span>
                        {isHidden && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">숨김</span>}
                        {!isHidden && past && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">지남</span>}
                      </p>
                      {(e.location || e.memo) && (
                        <p className={`mt-0.5 line-clamp-1 text-[11px] tracking-tighter text-slate-400 ${isHidden ? "line-through" : ""}`}>
                          {[e.location, e.memo].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {/* 못 가요 아이콘 (숨긴 일정·지난 일정은 표시 안 함) */}
                    {!past && !isHidden && (
                      <div onClick={(ev) => ev.stopPropagation()}>
                        <AbsenceControl eventId={e.id} list={absences[e.id] ?? []} onChanged={loadAbsences} />
                      </div>
                    )}
                  </div>
                );
              })
            ))}
          </div>
        );

        return (
          <div className="space-y-2">
            {cardList}
            {/* + 새로운 확정일정 버튼 — 슬라이드 애니메이션 (페이드 없음) */}
            {isAdmin && (
              <button
                onClick={() => { openNewForm(selectedDate ?? `${yearMonth}-01`); }}
                className="flex w-full items-center gap-2 rounded-2xl bg-[#1a2744] px-4 py-3.5 text-[14px] font-bold text-white hover:bg-[#243258] active:scale-[0.99]"
                style={{ animation: "slide-in-btn 480ms cubic-bezier(0.32,0.72,0,1) both" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                새로운 확정 일정
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ---------- 불참 의견 — 아이콘 버튼 + 바텀시트 ----------
function AbsenceControl({ eventId, list, onChanged }: { eventId: string; list: Absence[]; onChanged: () => void }) {
  const { user, profile } = useAuth();
  const mine = list.find((a) => a.uid === user?.uid);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "events", eventId, "absences", user.uid), {
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        reason: reason.trim(),
        createdAt: Date.now(),
      });
      setReason("");
      setSheetOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!user) return;
    await deleteDoc(doc(db, "events", eventId, "absences", user.uid));
    setSheetOpen(false);
    onChanged();
  }

  return (
    <>
      {/* 아이콘 버튼 */}
      <button
        onClick={() => setSheetOpen(true)}
        aria-label="이 날 못 가요"
        className={`mr-3 grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${
          mine ? "bg-red-50 text-red-500" : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
        }`}
      >
        {/* 🚫 ban icon */}
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
        </svg>
      </button>

      {/* 바텀시트 */}
      <BottomSheet open={sheetOpen} title="이 날 못 가요" onClose={() => setSheetOpen(false)}>
        <div className="space-y-4">
          {/* 불참 목록 */}
          {list.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500">🚫 못 가요 {list.length}명</p>
              <div className="space-y-1">
                {list.map((a) => (
                  <div key={a.uid} className="flex items-baseline gap-2 text-sm">
                    <span className="shrink-0 font-medium text-slate-700">{a.name}</span>
                    {a.reason && <span className="min-w-0 break-words text-slate-400">{a.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 내 불참 처리 */}
          {mine ? (
            <button
              onClick={cancel}
              className="w-full rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-500 transition hover:bg-red-50"
            >
              못 가요 취소하기
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="사유 (선택)"
                className="input w-full"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
              <button
                onClick={submit}
                disabled={busy}
                className="w-full rounded-xl bg-[#1a2744] py-3 text-sm font-bold text-white transition hover:bg-[#243258] disabled:opacity-50"
              >
                못 가요 등록
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

export default function SchedulePage() {
  return (
    <Guard>
      <ScheduleInner />
    </Guard>
  );
}
