"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CalendarIcon, ClockIcon, PencilIcon, PlusIcon, ShareIcon, TrashIcon, XIcon } from "@/components/Icons";
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

function getTeamColor(team: string | undefined, teams: string[]) {
  if (!team) return null;
  const idx = teams.indexOf(team);
  if (idx < 0) return null;
  return TEAM_PALETTE[idx] ?? { border: "rgb(148,163,184)", color: "rgb(100,116,139)", bg: "rgba(148,163,184,0.2)" };
}

// 팀별 달력 칩 색상 (배경 채우기 — 전체 일정과 동일한 방식, 팀 파스텔 색으로)
function teamChipStyle(team: string | undefined, teams: string[], passed = false): React.CSSProperties {
  if (passed || !team) return {};
  const c = getTeamColor(team, teams);
  if (!c) return {};
  return { backgroundColor: c.bg, color: c.color };
}

// 슬롯 "HH:mm" → "오전/오후 H:mm" 표기
function fmtTime(s: string) {
  const [h, m] = s.split(":").map(Number);
  if (h >= 24) return "24:00";
  const isPM = h >= 12;
  const disp = h === 12 ? 12 : h % 12;
  return `${isPM ? "오후" : "오전"} ${disp}:${String(m).padStart(2, "0")}`;
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
  const style: React.CSSProperties = c ? { borderColor: c.border, color: c.color } : {};
  return (
    <span
      style={style}
      className={`inline-flex shrink-0 items-center rounded-full border bg-white px-2 py-0.5 text-[11px] font-semibold ${!c ? "border-slate-200 text-slate-500" : ""} ${className}`}
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
          teams={teams}
          myTeam={myTeam}
          openNew={openNewEvent}
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
            const isPM = n >= 12;
            const disp = n === 12 ? 12 : n % 12;
            const prevIsPM = i > 0 ? Number(hours[i - 1]) >= 12 : null;
            const label = prevIsPM === null || prevIsPM !== isPM ? `${isPM ? "오후" : "오전"} ${disp}시` : `${disp}시`;
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
  onConfirmed: () => void;
}) {
  const [coords, setCoords] = useState<Coordination[]>([]);
  const [respCount, setRespCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null); // 만든 직후 확인 시트

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
    if (openNew) setShowCreate(true);
  }, [openNew]);

  async function createCoord(fields: {
    title: string;
    team: string;
    participantUids?: string[];
    candidateDates: string[];
    deadline?: number;
  }) {
    if (!uid) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, "coordinations", id), {
      title: fields.title,
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

  if (openCoord) {
    return (
      <CoordDetail
        coord={openCoord}
        isAdmin={isAdmin}
        uid={uid}
        myName={myName}
        myAvatar={myAvatar}
        myTeam={myTeam}
        denom={denomOf(openCoord)}
        onBack={() => {
          setOpenId(null);
          loadCoords();
        }}
        onChanged={loadCoords}
        onConfirmed={onConfirmed}
        onRemove={() => removeCoord(openCoord)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* 안내 */}
      <p className="text-[15px] leading-relaxed text-slate-500">
        단원들이 가능한 날짜를 고르는 링크를 만들고, 응답 현황을 확인해요.
      </p>

      {/* 만들기 — 스크롤해도 화면에 고정 */}
      <button
        onClick={() => setShowCreate(true)}
        className="sticky bottom-4 z-30 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-[15px] font-bold text-accent-fg shadow-[0_10px_24px_-10px_rgb(var(--accent))] transition hover:brightness-110 active:scale-[0.99]"
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") setOpenId(c.id);
                }}
                className="card cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)]"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-bold text-slate-900">{c.title}</p>
                      <AudienceBadge coord={c} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">{c.createdByName}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      done ? "bg-emerald-50 text-emerald-700" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {done ? "✓ 확정됨" : "● 진행 중"}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-500">
                  {done && c.confirmedDate ? (
                    <>확정 · <b className="text-slate-700">{fullDateLabel(c.confirmedDate)}</b></>
                  ) : (
                    <>응답 <b className="text-accent">{n}</b>{denom > 0 ? `/${denom}` : ""}명</>
                  )}
                </p>
                {!done && denom > 0 && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((n / denom) * 100))}%` }} />
                  </div>
                )}

                <div className="mt-3 flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      shareLink(c.title, linkOf(c.id));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-95"
                  >
                    <ShareIcon className="h-3.5 w-3.5" />
                    {done ? "확정 링크 공유" : "링크 공유"}
                  </button>
                  {(isAdmin || c.createdBy === uid) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCoord(c);
                      }}
                      aria-label="삭제"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                  <span className="ml-auto text-slate-300">›</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 일정방 만들기 */}
      <BottomSheet open={showCreate} title="일정방 만들기" onClose={() => setShowCreate(false)}>
        <CoordCreateForm teams={teams} myTeam={myTeam} onCreate={createCoord} />
      </BottomSheet>

      {/* 만든 직후 확인 시트 */}
      <BottomSheet open={!!createdCoord} onClose={() => setCreatedId(null)}>
        {createdCoord && (
          <div className="space-y-4 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500">
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
}: {
  teams: string[];
  myTeam: string;
  onCreate: (fields: {
    title: string;
    team: string;
    participantUids?: string[];
    candidateDates: string[];
    deadline?: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
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
  const todayStr = toDateStr(new Date());

  // 개별 선택 모드로 처음 전환할 때만 단원 목록 불러오기
  useEffect(() => {
    if (audienceMode !== "individual" || members.length > 0) return;
    setMembersLoading(true);
    (async () => {
      const snap = await getDocs(collection(db, "publicProfiles"));
      setMembers(
        snap.docs
          .map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }))
          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      );
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
      {/* 일정 이름 */}
      <div className="card !p-0 overflow-hidden">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 이름" />
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
            {([["", "전체 단원"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => (
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
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                      on ? "bg-accent-soft" : "hover:bg-slate-50"
                    }`}
                  >
                    <ProfileAvatar uid={m.uid} name={m.name} avatar={m.avatar} className="h-7 w-7 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{m.name}</span>
                    {m.team && <TeamBadge team={m.team} />}
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold transition ${
                        on ? "border-accent bg-accent text-accent-fg" : "border-slate-300 text-transparent"
                      }`}
                    >
                      ✓
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

      <button onClick={submit} disabled={busy} className="btn-accent w-full">
        {busy ? "만드는 중…" : "일정방 만들기"}
      </button>
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
  onBack,
  onChanged,
  onConfirmed,
  onRemove,
}: {
  coord: Coordination;
  isAdmin: boolean;
  uid: string;
  myName: string;
  myAvatar: string;
  myTeam: string;
  denom: number;
  onBack: () => void;
  onChanged: () => void;
  onConfirmed: () => void;
  onRemove: () => void;
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

  // 타임바 범위 선택: 첫 탭=앵커, 두 번째 탭=앵커~현재 사이 채우기/비우기
  function tapSlot(slot: string) {
    if (!activeDate || locked || !isParticipant) return;
    if (rangeAnchor === null) {
      setRangeAnchor(slot);
    } else if (rangeAnchor === slot) {
      setRangeAnchor(null); // 같은 칸 두 번 탭 → 앵커 해제
    } else {
      const iA = TIME_SLOTS.indexOf(rangeAnchor);
      const iB = TIME_SLOTS.indexOf(slot);
      const [lo, hi] = iA <= iB ? [iA, iB] : [iB, iA];
      const range = TIME_SLOTS.slice(lo, hi + 1);
      setSlotsByDate((prev) => {
        const cur = new Set(prev[activeDate] ?? []);
        const allOn = range.every((s) => cur.has(s));
        if (allOn) range.forEach((s) => cur.delete(s)); // 전부 켜져 있으면 → 끄기
        else range.forEach((s) => cur.add(s)); // 아니면 → 켜기
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
      await setDoc(doc(db, "coordinations", coord.id, "availability", uid), {
        uid,
        name: myName,
        avatar: myAvatar,
        team: myTeam,
        dates: myDates,
        slots: cleanedSlots,
        updatedAt: Date.now(),
      });
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
      {/* 상단 바 */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="뒤로" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100">
          <span className="text-2xl leading-none">‹</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-lg font-bold text-slate-900">{coord.title}</p>
            <AudienceBadge coord={coord} />
          </div>
          <p className={`text-xs font-semibold ${done ? "text-emerald-600" : "text-accent"}`}>
            {done ? "확정됨" : closed ? "응답 마감" : "진행 중"}
          </p>
        </div>
        {(isAdmin || coord.createdBy === uid) && (
          <button onClick={onRemove} aria-label="삭제" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500">
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
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
          {/* 응답 진행 */}
          <div className="card space-y-2.5">
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
          </div>

          {/* 초대 링크 공유 */}
          <button onClick={() => shareLink(coord.title, link)} className="btn-accent w-full !py-3.5">
            <ShareIcon className="h-4 w-4" />
            초대 링크 공유
          </button>
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
                  className={`flex h-full w-full flex-col items-center justify-center rounded-lg border text-[13px] leading-none transition ${
                    isConfirmed
                      ? "border-transparent bg-accent font-bold text-accent-fg"
                      : mine
                        ? "border-red-500 bg-red-500 font-bold text-white"
                        : cnt > 0
                          ? "font-semibold text-slate-800"
                          : "border-slate-200 bg-surface text-slate-500 hover:bg-slate-200"
                  } ${active && !isConfirmed ? "ring-2 ring-red-400 ring-offset-1" : ""}`}
                >
                  <span>{d.getDate()}</span>
                  <span className={`mt-0.5 text-[9px] font-bold ${isConfirmed ? "opacity-90" : mine ? "text-white/80" : cnt > 0 ? "text-red-600" : "text-slate-400"}`}>
                    {cnt}
                    {denom > 0 ? `/${denom}` : ""}
                  </span>
                </button>
              </div>
            );
          }}
        />
        <p className="mt-3 text-xs text-slate-400">
          {locked
            ? "응답이 마감된 일정방이에요."
            : !isParticipant
            ? "이 일정방의 응답 대상이 아니에요."
            : "후보 날짜를 탭하면 가능으로 표시돼요. 테두리가 진빨간색일수록 가능 인원이 많아요."}
        </p>
      </div>

      {/* 선택한 날짜 — 현황 보기 + 내 가능 시간 등록을 한 곳에서 */}
      {activeDate && (() => {
        const cnt = dateCount[activeDate] ?? 0;
        const best = bestRangeForDate(activeDate);
        const mine = myDates.includes(activeDate);
        return (
          <div className="card space-y-3">
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
              </div>
            )}

            {best && (
              <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                가장 겹치는 시간 <b className="text-slate-800">{best.start}~{best.end}</b> · {best.count}명
              </p>
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
          </div>
        );
      })()}

      {/* 일정 확정 (관리자) */}
      {isAdmin && !done && (
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
            className="btn-accent w-full"
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

      {/* 저장 바 — 스크롤해도 화면에 고정, 선택 시간 범위 표시 */}
      {!locked && isParticipant && (() => {
        const activeMine = activeDate && myDates.includes(activeDate);
        const activeSlots = activeMine ? [...(slotsByDate[activeDate!] ?? [])].sort() : null;
        const timeLabel = activeSlots === null
          ? null
          : activeSlots.length === 0
            ? "아무때나 가능"
            : `${fmtTime(activeSlots[0])} ~ ${fmtTime(slotEnd(activeSlots[activeSlots.length - 1]))}`;
        return (
          <div className="sticky bottom-4 z-30 rounded-2xl bg-white px-4 pb-4 pt-3 shadow-[0_10px_24px_-10px_rgba(16,24,40,0.25)]">
            <p className="mb-2.5 text-center text-sm text-slate-500">
              {timeLabel === "아무때나 가능"
                ? "⏰ 비워두면 아무때나 가능이에요"
                : timeLabel
                ? timeLabel
                : myDates.length > 0
                ? `내 가능 날짜 ${myDates.length}일 선택됨`
                : "날짜를 선택해 주세요"}
            </p>
            <button onClick={saveMine} disabled={!dirty || saving} className="btn-accent w-full !py-3 !text-base">
              {saving ? "저장 중…" : dirty ? "저장하기" : "저장됨 ✓"}
            </button>
          </div>
        );
      })()}

      {/* 확정 등록 (관리자) */}
      <BottomSheet open={!!confirmDraft} title="확정 일정 등록" onClose={() => setConfirmDraft(null)}>
        {confirmDraft && (
          <EventForm
            initial={{
              date: confirmDraft.date,
              startTime: confirmDraft.start,
              endTime: confirmDraft.end,
              title: coord.title,
              team: coord.team ?? "",
            }}
            onSaved={async (saved) => {
              await updateDoc(doc(db, "coordinations", coord.id), {
                status: "done",
                confirmedDate: saved.date,
                confirmedStart: saved.startTime || "",
                confirmedEnd: saved.endTime || "",
                confirmedAt: Date.now(),
              }).catch(() => {});
              setConfirmDraft(null);
              setActiveDate(saved.date);
              onChanged();
              onConfirmed();
            }}
            onCancel={() => setConfirmDraft(null)}
          />
        )}
      </BottomSheet>
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
  teams,
  myTeam,
  openNew = false,
}: {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  yearMonth: string;
  events: ScheduleEvent[];
  isAdmin: boolean;
  onChanged: () => void;
  highlightId?: string | null;
  teams: string[];
  myTeam: string;
  openNew?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 달력 그리드
  const [ym_year, ym_month] = yearMonth.split("-").map(Number);
  const miniGrid = useMemo(() => buildMonthGrid(ym_year, ym_month - 1), [ym_year, ym_month]);
  const todayStr = toDateStr(new Date());
  const formDate = `${yearMonth}-01`;
  useEffect(() => {
    if (openNew && isAdmin) setShowForm(true);
  }, [openNew, isAdmin]);

  // 팀 필터 (기본: 전체). 빈값이면 전체
  const [evTeam, setEvTeam] = useState("");
  const visibleEvents = events.filter((e) => teams.length === 0 || !evTeam || !e.team || e.team === evTeam);

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
      {/* 헤더: 월 이동 + 추가 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={onPrev} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
          <span className="text-lg font-bold text-slate-900">{monthLabel}</span>
          <button onClick={onNext} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            aria-label="일정 추가"
            title="일정 추가"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        )}
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
              chipStyle = isActive
                ? { borderColor: teamC.border, backgroundColor: teamC.bg, color: teamC.color }
                : { borderColor: teamC.border, color: teamC.color, backgroundColor: "transparent" };
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
        <BottomSheet open={showForm} title="확정 일정 등록" onClose={() => setShowForm(false)}>
          <EventForm
            key={formDate}
            initial={{ date: formDate, startTime: "", endTime: "" }}
            onSaved={() => {
              setShowForm(false);
              onChanged();
            }}
            onCancel={() => setShowForm(false)}
          />
        </BottomSheet>
      )}

      {/* 수정 BottomSheet */}
      {isAdmin && (
        <BottomSheet open={!!editEvent} title="확정 일정 수정" onClose={() => setEditEvent(null)}>
          {editEvent && (
            <EventForm
              key={editEvent.id}
              eventId={editEvent.id}
              initial={{ date: editEvent.date, startTime: editEvent.startTime, endTime: editEvent.endTime, title: editEvent.title, team: editEvent.team, location: editEvent.location, memo: editEvent.memo }}
              onSaved={() => { setEditEvent(null); onChanged(); }}
              onCancel={() => setEditEvent(null)}
            />
          )}
        </BottomSheet>
      )}

      {/* 풀 캘린더 */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
          {WEEKDAYS_KO.map((w) => (
            <div key={w} className="py-2 text-center text-[11px] font-bold text-slate-400">{w}</div>
          ))}
        </div>
        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {miniGrid.map((d, i) => {
            if (!d) return <div key={i} className="min-h-[88px] border-t border-slate-100" />;
            const ds = toDateStr(d);
            const isToday = ds === todayStr;
            const isSelected = ds === selectedDate;
            const dayEvents = visibleEvents.filter((e) => e.date === ds);
            const dow = d.getDay();
            return (
              <div
                key={i}
                onClick={() => {
                  if (dayEvents.length === 0) return;
                  const next = isSelected ? null : ds;
                  setSelectedDate(next);
                  if (next) {
                    setTimeout(() => {
                      const firstId = dayEvents[0]?.id;
                      if (firstId) {
                        document.getElementById(`ev-${firstId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }, 60);
                  }
                }}
                className={`relative min-h-[88px] cursor-default border-t border-slate-100 p-1 transition ${
                  dayEvents.length > 0 ? "cursor-pointer" : ""
                } ${isSelected ? "ring-2 ring-inset ring-accent rounded-xl" : ""}`}
              >
                <div className={`mb-1 mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                  isToday ? "bg-accent text-accent-fg" : "text-slate-700"
                }`}>
                  {d.getDate()}
                </div>
                <div className="space-y-px">
                  {dayEvents.slice(0, 3).map((e) => {
                    const passed = eventPassed(e);
                    const hasTeamColor = !passed && !!getTeamColor(e.team, teams);
                    return (
                      <div
                        key={e.id}
                        style={teamChipStyle(e.team, teams, passed)}
                        className={`truncate rounded px-0.5 text-[9px] font-medium leading-[13px] ${
                          passed ? "bg-slate-100 text-slate-400" : hasTeamColor ? "" : "bg-accent-soft text-accent"
                        }`}
                      >
                        {e.title}
                      </div>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <div className="px-0.5 text-[9px] font-medium text-slate-400">+{dayEvents.length - 3}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 일정 리스트 (간소화) */}
      {visibleEvents.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title={teams.length > 0 && evTeam ? `${evTeam} 확정 일정이 없습니다.` : "이번 달 확정 일정이 없습니다."}
        />
      ) : (
        <div className="space-y-1.5">
          {groups.map(([date, evs]) => {
            const d = new Date(date + "T00:00:00");
            return evs.map((e) => {
              const past = eventPassed(e);
              return (
                <div
                  key={e.id}
                  id={`ev-${e.id}`}
                  className={`relative flex items-start gap-3 overflow-hidden rounded-xl bg-white px-3 py-2.5 pl-4 shadow-sm transition ${
                    highlightId === e.id || date === selectedDate ? "ring-2 ring-accent" : ""
                  } ${past ? "opacity-50" : ""}`}
                >
                  {/* 왼쪽 팀 컬러 바 */}
                  <div
                    className="absolute bottom-0 left-0 top-0 w-[3px]"
                    style={{ backgroundColor: getTeamColor(e.team, teams)?.border ?? "rgb(var(--accent))" }}
                  />
                  {/* 날짜 배지 */}
                  <div className="w-7 shrink-0 text-center leading-none pt-0.5">
                    <p className="text-[10px] text-slate-400">{WEEKDAYS_KO[d.getDay()]}</p>
                    <p
                      className="text-base font-extrabold"
                      style={{ color: getTeamColor(e.team, teams)?.color ?? "rgb(var(--accent))" }}
                    >
                      {d.getDate()}
                    </p>
                  </div>
                  {/* 내용 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{e.title}</p>
                      <TeamBadge team={e.team} />
                      {past && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">지남</span>}
                    </div>
                    <EventMeta startTime={e.startTime} endTime={e.endTime} location={e.location} className="text-xs text-slate-400" />
                    {e.memo && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{e.memo}</p>}
                    {!past && <AbsenceControl eventId={e.id} list={absences[e.id] ?? []} onChanged={loadAbsences} />}
                  </div>
                  {isAdmin && (
                    <div className="mt-0.5 flex shrink-0 gap-0.5">
                      <button onClick={() => setEditEvent(e)} aria-label="수정" className="grid h-7 w-7 place-items-center rounded-md text-slate-300 transition hover:text-accent">
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button onClick={() => removeEvent(e.id)} aria-label="삭제" className="grid h-7 w-7 place-items-center rounded-md text-slate-300 transition hover:text-red-500">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            });
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 불참 의견 ('못 가요' + 사유) ----------
function AbsenceControl({ eventId, list, onChanged }: { eventId: string; list: Absence[]; onChanged: () => void }) {
  const { user, profile } = useAuth();
  const mine = list.find((a) => a.uid === user?.uid);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
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
      setEditing(false);
      setReason("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!user) return;
    await deleteDoc(doc(db, "events", eventId, "absences", user.uid));
    onChanged();
  }

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      {list.length > 0 && (
        <div className="mb-2">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
            🚫 못 가요 {list.length}명
            <span className="text-[10px] text-slate-400">{open ? "▲" : "▼"}</span>
          </button>
          {open && (
            <div className="mt-1.5 space-y-1">
              {list.map((a) => (
                <div key={a.uid} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-medium text-slate-700">{a.name}</span>
                  {a.reason && <span className="min-w-0 break-words text-slate-400">{a.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {mine ? (
        <button onClick={cancel} className="text-xs font-medium text-accent hover:underline">못 감 표시함 · 취소</button>
      ) : editing ? (
        <div className="flex items-center gap-1.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유(선택)"
            className="input flex-1 !py-1 !text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button onClick={submit} disabled={busy} className="btn-accent !px-2.5 !py-1 !text-xs">확인</button>
          <button onClick={() => setEditing(false)} className="btn-ghost !px-2.5 !py-1 !text-xs">취소</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs font-medium text-slate-500 hover:text-red-500">이 날 못 가요</button>
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Guard>
      <ScheduleInner />
    </Guard>
  );
}
