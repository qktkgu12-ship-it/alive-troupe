"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import CoordForm from "@/components/forms/CoordForm";
import EventForm from "@/components/forms/EventForm";
import { useCreateSheet } from "@/lib/create-sheet-context";
import { ProfileAvatar } from "@/components/ProfileViewer";
import EmptyState from "@/components/EmptyState";
import EventMeta from "@/components/EventMeta";
import { CalendarIcon, PlusIcon, TrashIcon, XIcon } from "@/components/Icons";
import type { Absence, Availability, Coordination, PublicProfile, ScheduleEvent } from "@/lib/types";
import {
  buildMonthGrid,
  slotEnd,
  TIME_SLOTS,
  toDateStr,
  toYearMonth,
  WEEKDAYS_KO,
} from "@/lib/utils";

type Tab = "events" | "coord" | "past";

const TAB_ORDER: Tab[] = ["events", "coord", "past"];
const TAB_INFO: Record<Tab, { label: string; desc: string }> = {
  events: { label: "확정", desc: "확정된 다가오는 일정을 확인하세요." },
  coord: { label: "잡는 중", desc: "내 가능 시간을 제출하고, 단원들과 겹치는 시간을 한눈에 확인하세요." },
  past: { label: "지난 일정", desc: "이미 지난 일정을 모아 봅니다." },
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

// 선택된 슬롯들을 연속 구간 문자열로 ("18:00~22:00")
function slotRanges(slots: string[]): string[] {
  const set = new Set(slots);
  const out: string[] = [];
  let i = 0;
  while (i < TIME_SLOTS.length) {
    if (set.has(TIME_SLOTS[i])) {
      let j = i;
      while (j + 1 < TIME_SLOTS.length && set.has(TIME_SLOTS[j + 1])) j++;
      out.push(`${TIME_SLOTS[i]}~${slotEnd(TIME_SLOTS[j])}`);
      i = j + 1;
    } else i++;
  }
  return out;
}

const hourOf = (s: string) => parseInt(s.slice(0, 2), 10);
const MORNING = TIME_SLOTS.filter((s) => hourOf(s) < 12); // 09:00~12:00
const AFTERNOON = TIME_SLOTS.filter((s) => hourOf(s) >= 12 && hourOf(s) < 18); // 12:00~18:00
const EVENING = TIME_SLOTS.filter((s) => hourOf(s) >= 18); // 18:00~24:00
const SLOT_GROUPS: [string, string[]][] = [
  ["오전", MORNING],
  ["오후", AFTERNOON],
  ["저녁", EVENING],
];

// 팀 배지 (전체 공통이면 표시 안 함)
function TeamBadge({ team, className = "" }: { team?: string; className?: string }) {
  if (!team) return null;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent ${className}`}>
      {team}
    </span>
  );
}

function ScheduleInner() {
  const { user, profile, role } = useAuth();
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const myTeam = profile?.team ?? "";
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // 조율 카드(Doodle식): 카드 목록 + 지금 연 카드(전체화면 상세)
  const [coords, setCoords] = useState<Coordination[]>([]);
  const [openCoordId, setOpenCoordId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const openCoord = coords.find((c) => c.id === openCoordId) ?? null;
  const coordClosed = !!openCoord?.deadline && Date.now() > openCoord.deadline;
  const coordLocked = coordClosed || openCoord?.status === "done"; // 수정 불가(마감 또는 확정)
  function closeCoord() {
    setOpenCoordId(null);
  }
  // 팀별 단원 수(총원 분모) — publicProfiles 1회 집계
  const [memberStat, setMemberStat] = useState<{ total: number; byTeam: Record<string, number> }>({ total: 0, byTeam: {} });
  const [tab, setTab] = useState<Tab>("events");
  const [confirmDraft, setConfirmDraft] = useState<{ date: string; start: string; end: string } | null>(null);
  const [highlightEvent, setHighlightEvent] = useState<string | null>(null);

  // 헤더 '+' 등록 메뉴에서 확정 일정 등록으로 들어온 경우
  const [openNewEvent, setOpenNewEvent] = useState(false);

  // 홈 '다가오는 일정'에서 넘어온 경우: 확정 일정 탭으로 이동 + 해당 일정 강조
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tabParam = p.get("tab");
    if (tabParam === "events") setTab("events");
    else if (tabParam === "coord") setTab("coord");
    else if (tabParam === "past") setTab("past");
    // '+' 등록 메뉴: 해당 탭의 등록 폼을 바로 열기
    if (p.get("new") === "1") {
      if (tabParam === "coord") setShowCreate(true);
      else setOpenNewEvent(true);
    }
    // 일정 날짜가 넘어오면 그 달로 달력 이동 (7월 일정인데 6월이 보이던 버그 수정)
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
  const grid = useMemo(() => buildMonthGrid(year, month0), [year, month0]);
  const todayStr = toDateStr(new Date());

  // 내 가능 일정
  const [myDates, setMyDates] = useState<string[]>([]);
  const [slotsByDate, setSlotsByDate] = useState<Record<string, string[]>>({});
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // 전체 현황
  const [allAvail, setAllAvail] = useState<Availability[]>([]);

  // 확정 일정
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  // 조율 카드 목록
  const loadCoords = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "coordinations"), orderBy("createdAt", "desc")));
    setCoords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Coordination, "id">) })));
  }, []);

  // 팀별 단원 수(응답 진행률의 분모) — publicProfiles 1회 집계
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

  // 지금 연 카드에 대한 '내 가능 일정'
  const loadMine = useCallback(async () => {
    if (!user || !openCoordId) {
      setMyDates([]);
      setSlotsByDate({});
      setDirty(false);
      return;
    }
    const snap = await getDoc(doc(db, "coordinations", openCoordId, "availability", user.uid));
    if (snap.exists()) {
      const a = snap.data() as Availability;
      setMyDates([...(a.dates ?? [])].sort());
      setSlotsByDate(a.slots ?? {});
    } else {
      setMyDates([]);
      setSlotsByDate({});
    }
    setDirty(false);
  }, [user, openCoordId]);

  // 지금 연 카드의 '전체 가능 현황'
  const loadAll = useCallback(async () => {
    if (!openCoordId) {
      setAllAvail([]);
      return;
    }
    const snap = await getDocs(collection(db, "coordinations", openCoordId, "availability"));
    setAllAvail(snap.docs.map((d) => d.data() as Availability));
  }, [openCoordId]);

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

  // 조율 카드 목록 + 단원 수 로드
  useEffect(() => {
    loadCoords();
    loadMemberStat();
  }, [loadCoords, loadMemberStat]);

  // 연 카드가 바뀌면 그 카드의 내/전체 가능일정 로드
  useEffect(() => {
    loadMine();
    loadAll();
    setActiveDate(null);
    setRangeAnchor(null);
  }, [loadMine, loadAll]);

  // 카드를 열면 '대상 달'로 달력 이동 (설정돼 있을 때만)
  useEffect(() => {
    if (!openCoordId) return;
    const c = coords.find((x) => x.id === openCoordId);
    if (c?.targetMonth && /^\d{4}-\d{2}$/.test(c.targetMonth)) {
      const [y, m] = c.targetMonth.split("-").map(Number);
      setCursor(new Date(y, m - 1, 1));
    }
  }, [openCoordId, coords]);

  // 확정/지난 일정은 보는 달이 바뀌면 새로 로드
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // 헤더 '+' 바텀시트로 조율·일정을 만들면 목록 새로고침
  const { createdAt } = useCreateSheet();
  useEffect(() => {
    if (createdAt?.kind === "coord") loadCoords();
    if (createdAt?.kind === "event") loadEvents();
  }, [createdAt, loadCoords, loadEvents]);

  // ----- 내 가능 일정 편집 -----
  // 탭: 미선택 → 선택+열기 / 선택&활성 → 해제 / 선택&비활성 → 열기(편집)
  function tapDate(ds: string) {
    if (coordLocked) return;
    const selected = myDates.includes(ds);
    if (!selected) {
      setMyDates((prev) => [...prev, ds].sort());
      setActiveDate(ds);
      setRangeAnchor(null);
      setDirty(true);
    } else if (activeDate === ds) {
      removeDate(ds);
    } else {
      setActiveDate(ds);
      setRangeAnchor(null);
    }
  }

  function removeDate(ds: string) {
    if (coordLocked) return;
    setMyDates((prev) => prev.filter((d) => d !== ds));
    setSlotsByDate((s) => {
      const n = { ...s };
      delete n[ds];
      return n;
    });
    if (activeDate === ds) setActiveDate(null);
    setDirty(true);
  }

  // 시작→끝 두 번 탭하면 사이를 채움
  function pickSlot(slot: string) {
    if (!activeDate || coordLocked) return;
    if (rangeAnchor === null) {
      setRangeAnchor(slot);
      return;
    }
    const a = TIME_SLOTS.indexOf(rangeAnchor);
    const b = TIME_SLOTS.indexOf(slot);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const range = TIME_SLOTS.slice(lo, hi + 1);
    setSlotsByDate((prev) => {
      const set = new Set(prev[activeDate] ?? []);
      range.forEach((s) => set.add(s));
      return { ...prev, [activeDate]: [...set] };
    });
    setRangeAnchor(null);
    setDirty(true);
  }

  function setPreset(slots: string[]) {
    if (!activeDate || coordLocked) return;
    setSlotsByDate((prev) => ({ ...prev, [activeDate]: slots }));
    setRangeAnchor(null);
    setDirty(true);
  }

  async function saveMine() {
    if (!user || !openCoordId) return;
    setSaving(true);
    try {
      const cleanedSlots: Record<string, string[]> = {};
      for (const d of myDates) {
        const arr = slotsByDate[d];
        if (arr && arr.length > 0) cleanedSlots[d] = arr;
      }
      await setDoc(doc(db, "coordinations", openCoordId, "availability", user.uid), {
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        avatar: profile?.avatar || "",
        team: myTeam,
        dates: myDates,
        slots: cleanedSlots,
        updatedAt: Date.now(),
      });
      setDirty(false);
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  // 조율 카드 만들기 (누구나) / 삭제
  async function createCoord(fields: Omit<Coordination, "id" | "createdBy" | "createdByName" | "status" | "createdAt">) {
    if (!user) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, "coordinations", id), {
      ...fields,
      createdBy: user.uid,
      createdByName: profile?.name || profile?.displayName || "",
      status: "open",
      createdAt: Date.now(),
    });
    setShowCreate(false);
    await loadCoords();
  }
  async function removeCoord(c: Coordination) {
    if (!confirm(`'${c.title}' 조율을 삭제할까요? 제출된 가능시간도 함께 사라져요.`)) return;
    const av = await getDocs(collection(db, "coordinations", c.id, "availability"));
    await Promise.all(av.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "coordinations", c.id));
    if (openCoordId === c.id) setOpenCoordId(null);
    await loadCoords();
  }

  // ----- 전체 현황 집계 (카드별이라 팀 필터 불필요) -----
  const scopedAvail = allAvail;

  const { slotCount, submitters } = useMemo(() => {
    const slotCount: Record<string, Record<string, number>> = {};
    for (const a of scopedAvail) {
      for (const date of a.dates ?? []) {
        const specific = a.slots?.[date];
        const list = specific && specific.length > 0 ? specific : TIME_SLOTS; // 아무때나 → 전체
        slotCount[date] ??= {};
        for (const s of list) slotCount[date][s] = (slotCount[date][s] ?? 0) + 1;
      }
    }
    return { slotCount, submitters: scopedAvail.length };
  }, [scopedAvail]);

  // 날짜별 가능 인원(히트맵용) — 그 날 가능하다고 제출한 사람 수
  const dateCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of scopedAvail) for (const ds of a.dates ?? []) m[ds] = (m[ds] ?? 0) + 1;
    return m;
  }, [scopedAvail]);
  const maxDateCount = useMemo(() => Math.max(0, ...Object.values(dateCount)), [dateCount]);

  // 응답 진행률의 분모(대상 팀 인원, 전체 공통이면 전체 단원)
  const denom = openCoord ? (openCoord.team ? memberStat.byTeam[openCoord.team] ?? 0 : memberStat.total) : 0;

  // 특정 날짜에서 가장 많이 겹치는 연속 시간대
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

  // 활성 날짜에서 '나 말고' 시간대별 가능 인원
  const othersBySlot = useMemo(() => {
    const m: Record<string, number> = {};
    if (!activeDate) return m;
    for (const a of scopedAvail) {
      if (a.uid === user?.uid) continue;
      if (!(a.dates ?? []).includes(activeDate)) continue;
      const specific = a.slots?.[activeDate];
      const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
      for (const s of list) m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [activeDate, scopedAvail, user?.uid]);

  // 활성 날짜에 가능한 단원 (사진·이름, 이름 내림차순)
  const membersForActive = useMemo(() => {
    if (!activeDate) return [];
    const map = new Map<string, { uid: string; name: string; avatar?: string }>();
    for (const a of scopedAvail) {
      if ((a.dates ?? []).includes(activeDate)) {
        // 본인은 실시간 프로필 사진을 우선 사용 (옛 제출 데이터에 사진이 없어도 바로 보이게)
        const avatar = a.uid === user?.uid ? profile?.avatar || a.avatar : a.avatar;
        map.set(a.uid, { uid: a.uid, name: a.name || "이름없음", avatar });
      }
    }
    return [...map.values()].sort((x, y) => y.name.localeCompare(x.name, "ko"));
  }, [activeDate, scopedAvail, user?.uid, profile?.avatar]);


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
      <p className="-mt-2 text-center text-xs text-slate-400">{TAB_INFO[tab].desc}</p>

      {/* ===== 잡는 중 (조율 카드 목록 → 누르면 바텀시트) ===== */}
      {tab === "coord" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">조율할 주제를 만들고, 각자 가능 시간을 제출하세요.</p>
            <button
              onClick={() => setShowCreate((v) => !v)}
              aria-label={showCreate ? "닫기" : "조율 만들기"}
              title={showCreate ? "닫기" : "조율 만들기"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
            >
              {showCreate ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
            </button>
          </div>

          <BottomSheet open={showCreate} title="일정 조율 만들기" onClose={() => setShowCreate(false)}>
            <CoordForm teams={teams} onCreate={createCoord} onCancel={() => setShowCreate(false)} />
          </BottomSheet>

          {coords.length === 0 ? (
            <div className="card">
              <EmptyState icon={CalendarIcon} title="진행 중인 조율이 없습니다." hint="위 + 버튼으로 새 조율을 만들어 보세요." />
            </div>
          ) : (
            <div className="space-y-2">
              {coords.map((c) => {
                const closed = !!c.deadline && Date.now() > c.deadline;
                const canManage = role === "admin" || c.createdBy === user?.uid;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenCoordId(c.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") setOpenCoordId(c.id); }}
                    className={`card flex cursor-pointer items-start gap-3 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)] ${c.status === "done" ? "opacity-70" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-bold text-slate-900">{c.title}</p>
                        <TeamBadge team={c.team} />
                        {c.status === "done" ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">완료</span>
                        ) : closed ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">마감</span>
                        ) : null}
                      </div>
                      {c.memo && <p className="mt-0.5 truncate text-sm text-slate-500">{c.memo}</p>}
                      <p className="mt-1 text-xs text-slate-400">
                        {[
                          c.targetMonth ? `${c.targetMonth.slice(0, 4)}년 ${Number(c.targetMonth.slice(5, 7))}월` : "",
                          c.deadline ? `${deadlineLabel(c.deadline)} 마감` : "",
                          c.createdByName,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeCoord(c); }}
                        aria-label="삭제"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                    <span className="shrink-0 self-center text-sm font-semibold text-accent">열기 ›</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== 전체화면 상세: 카드를 누르면 열림 ===== */}
          {openCoord && (
            <div className="fixed inset-0 z-[60] flex flex-col bg-canvas">
              {/* 상단 바 */}
              <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-2 py-2.5 backdrop-blur">
                <button onClick={closeCoord} aria-label="뒤로" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100">
                  <span className="text-2xl leading-none">‹</span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-bold text-slate-900">{openCoord.title}</p>
                    <TeamBadge team={openCoord.team} />
                  </div>
                </div>
                {(role === "admin" || openCoord.createdBy === user?.uid) && (
                  <button onClick={() => removeCoord(openCoord)} aria-label="삭제" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </header>

              {/* 본문 (스크롤) */}
              <div className="animate-sheet-up mx-auto w-full max-w-2xl flex-1 space-y-4 overflow-y-auto p-4">
                {/* 응답 진행 헤더 */}
                <div className="card space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-700">
                      {openCoord.status === "done" ? "약속이 확정됐어요" : coordClosed ? "제출이 마감됐어요" : "단원들의 응답을 기다리고 있어요"}
                    </p>
                    {maxDateCount > 0 && openCoord.status !== "done" && (
                      <span className="shrink-0 text-xs text-slate-400">최고 후보 {maxDateCount}명</span>
                    )}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${denom > 0 ? Math.min(100, Math.round((submitters / denom) * 100)) : submitters > 0 ? 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>응답 <b className="text-accent">{submitters}</b>{denom > 0 ? `/${denom}` : ""}명</span>
                    {openCoord.deadline && <span>{coordClosed ? "마감됨" : `${deadlineLabel(openCoord.deadline)} 마감`}</span>}
                  </div>
                  {openCoord.memo && <p className="border-t border-slate-100 pt-2.5 text-sm text-slate-500">{openCoord.memo}</p>}
                </div>

                {/* 확정 결과 카드 */}
                {openCoord.status === "done" && openCoord.confirmedDate && (() => {
                  const cd = new Date(openCoord.confirmedDate + "T00:00:00");
                  const cnt = dateCount[openCoord.confirmedDate] ?? 0;
                  const timeStr = openCoord.confirmedStart
                    ? `${openCoord.confirmedStart}${openCoord.confirmedEnd ? `~${openCoord.confirmedEnd}` : ""}`
                    : "";
                  return (
                    <div className="rounded-2xl bg-accent p-5 text-center text-accent-fg shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)]">
                      <p className="inline-flex items-center gap-1.5 text-sm font-semibold opacity-90">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs">✓</span>
                        약속 확정 완료
                      </p>
                      <p className="mt-2 text-3xl font-extrabold tracking-tight">{cd.getMonth() + 1}월 {cd.getDate()}일</p>
                      <p className="mt-1 text-sm opacity-90">{WEEKDAYS_KO[cd.getDay()]}요일{timeStr ? ` · ${timeStr}` : ""}</p>
                      {cnt > 0 && <p className="mt-0.5 text-xs opacity-75">{cnt}{denom > 0 ? `/${denom}` : ""}명 가능</p>}
                    </div>
                  );
                })()}

                {/* 날짜별 현황 (히트맵) */}
                <div className="card">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-bold text-slate-900">날짜별 현황</h2>
                    <div className="flex items-center gap-1">
                      <button onClick={() => changeMonth(-1)} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
                      <span className="min-w-[84px] text-center text-sm font-semibold text-slate-700">{year}년 {month0 + 1}월</span>
                      <button onClick={() => changeMonth(1)} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
                    </div>
                  </div>
                  <CalendarGrid
                    grid={grid}
                    renderCell={(d) => {
                      const ds = toDateStr(d);
                      const cnt = dateCount[ds] ?? 0;
                      const active = activeDate === ds;
                      const ratio = denom > 0 ? cnt / denom : maxDateCount > 0 ? cnt / maxDateCount : 0;
                      const style = cnt > 0
                        ? {
                            backgroundColor: `rgba(16,185,129,${0.12 + 0.55 * Math.min(1, ratio)})`,
                            borderColor: `rgba(16,185,129,${0.35 + 0.4 * Math.min(1, ratio)})`,
                          }
                        : undefined;
                      return (
                        <button
                          onClick={() => setActiveDate(active ? null : ds)}
                          style={style}
                          className={`flex h-full w-full flex-col items-center justify-center rounded-lg border text-[13px] leading-none transition ${
                            cnt > 0 ? "font-semibold text-slate-800" : "border-transparent text-slate-500 hover:bg-slate-100"
                          } ${active ? "ring-2 ring-accent ring-offset-1" : ds === todayStr ? "ring-1 ring-accent/40" : ""}`}
                        >
                          <span>{d.getDate()}</span>
                          {cnt > 0 && <span className="mt-0.5 text-[9px] font-bold text-emerald-700">{cnt}{denom > 0 ? `/${denom}` : ""}</span>}
                        </button>
                      );
                    }}
                  />
                  <p className="mt-3 text-xs text-slate-400">
                    {maxDateCount > 0 ? "날짜를 누르면 그날 가능한 단원과 시간대를 볼 수 있어요." : "아직 제출된 가능일이 없어요."}
                  </p>
                </div>

                {/* 선택한 날짜 상세 */}
                {activeDate && (() => {
                  const cnt = dateCount[activeDate] ?? 0;
                  const best = bestRangeForDate(activeDate);
                  return (
                    <div className="card space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-400">선택한 날짜</p>
                          <p className="font-bold text-slate-900">{fullDateLabel(activeDate)}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{cnt}{denom > 0 ? `/${denom}` : ""} 가능</span>
                      </div>

                      {cnt > 0 ? (
                        <>
                          {best && (
                            <p className="text-xs text-slate-500">가장 겹치는 시간 <b className="text-slate-800">{best.start}~{best.end}</b> · {best.count}명</p>
                          )}
                          <div className="space-y-2">
                            {SLOT_GROUPS.map(([label, group]) => (
                              <div key={label}>
                                <p className="mb-1 text-[10px] font-semibold text-slate-400">{label}</p>
                                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                                  {group.map((s) => {
                                    const c = slotCount[activeDate]?.[s] ?? 0;
                                    const r = denom > 0 ? c / denom : maxDateCount > 0 ? c / maxDateCount : 0;
                                    return (
                                      <div
                                        key={s}
                                        title={`${s}~${slotEnd(s)} · ${c}명`}
                                        style={c > 0 ? { backgroundColor: `rgba(16,185,129,${0.12 + 0.55 * Math.min(1, r)})` } : undefined}
                                        className={`rounded-md py-1 text-center text-[11px] tabular-nums ${c > 0 ? "font-semibold text-slate-800" : "bg-surface text-slate-300"}`}
                                      >
                                        {s.slice(0, 2)}
                                        {c > 0 && <span className="ml-0.5 text-[9px] text-emerald-700">·{c}</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">이 날 가능한 단원이 아직 없어요.</p>
                      )}

                      {membersForActive.length > 0 && (
                        <div className="border-t border-slate-100 pt-3">
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
                      )}

                      {role === "admin" && openCoord.status !== "done" && cnt > 0 && (
                        <button
                          onClick={() => setConfirmDraft({ date: activeDate, start: best?.start ?? "", end: best?.end ?? "" })}
                          className="btn-accent w-full"
                        >
                          이 날짜로 확정하기
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* 내 가능 시간 수정 */}
                {coordLocked ? (
                  <p className="rounded-xl bg-surface px-3 py-3 text-center text-xs text-slate-400">
                    {openCoord.status === "done" ? "확정된 조율이라 가능 시간을 수정할 수 없어요." : "마감된 조율이라 가능 시간을 수정할 수 없어요."}
                  </p>
                ) : (
                  <div className="card">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-bold text-slate-900">내 가능 시간 수정</h2>
                      <div className="flex items-center gap-1">
                        <button onClick={() => changeMonth(-1)} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
                        <button onClick={() => changeMonth(1)} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
                      </div>
                    </div>
                    <CalendarGrid
                      grid={grid}
                      renderCell={(d) => {
                        const ds = toDateStr(d);
                        const mine = myDates.includes(ds);
                        const active = activeDate === ds;
                        return (
                          <button
                            onClick={() => tapDate(ds)}
                            className={`flex h-full w-full items-center justify-center rounded-full text-sm transition ${
                              mine ? "bg-accent font-bold text-accent-fg" : "text-slate-700 hover:bg-slate-100"
                            } ${active ? "ring-2 ring-accent ring-offset-1" : !mine && ds === todayStr ? "ring-1 ring-accent" : ""}`}
                          >
                            {d.getDate()}
                          </button>
                        );
                      }}
                    />
                    {activeDate && myDates.includes(activeDate) ? (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <div className="mb-1 flex items-center justify-between">
                          <h3 className="font-bold text-slate-900">{dateLabel(activeDate).md} ({dateLabel(activeDate).dow}) 가능 시간</h3>
                          <button onClick={() => removeDate(activeDate)} className="text-xs font-medium text-slate-400 transition hover:text-red-500">이 날 빼기</button>
                        </div>
                        <p className="mb-2.5 text-xs text-slate-400">
                          {rangeAnchor ? `${rangeAnchor} 부터… 끝 시간을 누르세요` : "시작 시간을 누르고 끝 시간을 누르면 사이가 채워져요."}
                        </p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {([["오전", MORNING], ["오후", AFTERNOON], ["저녁", EVENING], ["하루 종일", [...TIME_SLOTS]], ["해제", []]] as [string, string[]][]).map(([label, slots]) => (
                            <button key={label} onClick={() => setPreset(slots)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50">{label}</button>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {SLOT_GROUPS.map(([label, group]) => (
                            <div key={label}>
                              <p className="mb-1.5 text-[11px] font-semibold text-slate-400">{label}</p>
                              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                                {group.map((s) => {
                                  const sel = (slotsByDate[activeDate] ?? []).includes(s);
                                  const isAnchor = rangeAnchor === s;
                                  const others = othersBySlot[s] ?? 0;
                                  return (
                                    <button
                                      key={s}
                                      onClick={() => pickSlot(s)}
                                      title={`${s} ~ ${slotEnd(s)}${others > 0 ? ` · ${others}명 가능` : ""}`}
                                      className={`rounded-lg border py-1.5 text-xs tabular-nums transition ${
                                        isAnchor ? "border-accent bg-accent text-accent-fg" : sel ? "border-accent/30 bg-accent-soft text-accent" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                                      }`}
                                    >
                                      {s}
                                      {others > 0 && <span className={`ml-0.5 text-[9px] ${isAnchor ? "opacity-80" : "text-slate-400"}`}>·{others}</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-400">가능한 날짜를 눌러 선택하면 그 아래에서 시간을 고를 수 있어요. 같은 날을 다시 누르면 해제돼요.</p>
                    )}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-sm text-slate-500">선택 <b className="text-accent">{myDates.length}</b>일</span>
                      <button onClick={saveMine} disabled={!dirty || saving} className="btn-accent">
                        {saving ? "저장 중…" : dirty ? "내 시간 저장" : "저장됨 ✓"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 확정 등록 (관리자) : 확정 시 카드 완료 + 확정 정보 기록 */}
          <BottomSheet open={!!confirmDraft} title="확정 일정 등록" onClose={() => setConfirmDraft(null)}>
            {confirmDraft && (
              <EventForm
                initial={{ date: confirmDraft.date, startTime: confirmDraft.start, endTime: confirmDraft.end, title: openCoord?.title, team: openCoord?.team ?? "" }}
                onSaved={async (saved) => {
                  if (openCoordId) {
                    await updateDoc(doc(db, "coordinations", openCoordId), {
                      status: "done",
                      confirmedDate: saved.date,
                      confirmedStart: saved.startTime || "",
                      confirmedEnd: saved.endTime || "",
                    }).catch(() => {});
                  }
                  const dt = saved.date;
                  setConfirmDraft(null);
                  await loadCoords();
                  await loadEvents();
                  setActiveDate(dt);
                }}
                onCancel={() => setConfirmDraft(null)}
              />
            )}
          </BottomSheet>
        </div>
      )}

      {/* ===== 확정 (다가오는 일정) ===== */}
      {tab === "events" && (
        <EventsSection
          mode="upcoming"
          monthLabel={`${year}년 ${month0 + 1}월`}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          yearMonth={yearMonth}
          events={events}
          isAdmin={role === "admin"}
          onChanged={loadEvents}
          highlightId={highlightEvent}
          teams={teams}
          myTeam={myTeam}
          openNew={openNewEvent}
        />
      )}

      {/* ===== 지난 일정 ===== */}
      {tab === "past" && (
        <EventsSection
          mode="past"
          monthLabel={`${year}년 ${month0 + 1}월`}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          yearMonth={yearMonth}
          events={events}
          isAdmin={role === "admin"}
          onChanged={loadEvents}
          highlightId={highlightEvent}
          teams={teams}
          myTeam={myTeam}
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
        {WEEKDAYS_KO.map((w, i) => (
          <div key={w} className={i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}>{w}</div>
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


// ---------- 확정/지난 일정 (월 표시 + 일정 리스트) ----------
function EventsSection({
  mode,
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
  mode: "upcoming" | "past";
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
  openNew?: boolean; // 헤더 '+' 등록 메뉴로 들어오면 등록 폼 바로 열기
}) {
  const isPast = mode === "past";
  const canAdd = isAdmin && !isPast; // 지난 일정 탭에서는 추가 없음
  const [showForm, setShowForm] = useState(false);
  const formDate = `${yearMonth}-01`; // 등록 폼 기본 날짜(달 1일) — 실제 날짜는 폼에서 선택
  // 헤더 '+' 등록 메뉴에서 들어온 경우 (관리자만)
  useEffect(() => {
    if (openNew && canAdd) setShowForm(true);
  }, [openNew, canAdd]);

  // 팀 필터 (기본: 내 팀 = 공통 + 내 팀). 빈값이면 전체
  const [evTeam, setEvTeam] = useState(myTeam);
  useEffect(() => {
    setEvTeam(myTeam);
  }, [myTeam]);
  const visibleEvents = events
    .filter((e) => teams.length === 0 || !evTeam || !e.team || e.team === evTeam)
    .filter((e) => (isPast ? eventPassed(e) : !eventPassed(e))); // 탭에 따라 지난/다가오는 것만

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

  // 다가오는 일정은 가까운 순(오름차순), 지난 일정은 최근 순(내림차순)
  const sortedEvents = [...visibleEvents].sort((a, b) => {
    const ka = a.date + (a.startTime || "");
    const kb = b.date + (b.startTime || "");
    return isPast ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });

  // 날짜별로 묶기 (왼쪽 날짜 1개 + 그 날 일정 카드들)
  const groups: [string, ScheduleEvent[]][] = [];
  for (const e of sortedEvents) {
    const last = groups[groups.length - 1];
    if (last && last[0] === e.date) last[1].push(e);
    else groups.push([e.date, [e]]);
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onPrev} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
          <span className="text-lg font-bold text-slate-900">{monthLabel}</span>
          <button onClick={onNext} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
        </div>
        {canAdd && (
          <button
            onClick={() => setShowForm((v) => !v)}
            aria-label={showForm ? "닫기" : "일정 추가"}
            title={showForm ? "닫기" : "일정 추가"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition hover:brightness-110"
          >
            {showForm ? <XIcon className="h-5 w-5" /> : <PlusIcon className="h-5 w-5" />}
          </button>
        )}
      </div>

        {/* 팀 필터 (팀이 있을 때만) — 기본 내 팀, '전체'로 전환 가능 */}
        {teams.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([["", "전체"], ...teams.map((t) => [t, t] as [string, string])] as [string, string][]).map(([val, label]) => (
              <button
                key={val || "all"}
                onClick={() => setEvTeam(val)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  evTeam === val ? "border-accent bg-accent-soft text-accent" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {canAdd && (
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

        {visibleEvents.length === 0 ? (
          <EmptyState icon={CalendarIcon} title={isPast ? "이번 달 지난 일정이 없습니다." : teams.length > 0 && evTeam ? `${evTeam} 확정 일정이 없습니다.` : "이번 달 확정 일정이 없습니다."} />
        ) : (
          <div className="space-y-5">
            {groups.map(([date, evs]) => {
              const d = new Date(date + "T00:00:00");
              return (
                <div key={date} className="flex gap-3">
                  {/* 날짜 (왼쪽, 하루 1번) */}
                  <div className="w-9 shrink-0 pt-1.5 text-center leading-none">
                    <p className="text-[11px] font-medium text-slate-400">{WEEKDAYS_KO[d.getDay()]}</p>
                    <p className="mt-1 text-2xl font-extrabold text-accent">{d.getDate()}</p>
                  </div>
                  {/* 그 날 일정 카드들 */}
                  <div className="min-w-0 flex-1 space-y-2">
                    {evs.map((e) => {
                      const past = eventPassed(e);
                      return (
                        <div
                          key={e.id}
                          id={`ev-${e.id}`}
                          className={`rounded-xl bg-white p-3 shadow-[0_1px_3px_rgba(16,24,40,0.05),0_6px_16px_-8px_rgba(16,24,40,0.12)] transition ${
                            highlightId === e.id ? "ring-2 ring-accent" : ""
                          } ${past ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <p className="min-w-0 truncate font-semibold">{e.title}</p>
                              <TeamBadge team={e.team} />
                            </div>
                            {isAdmin && (
                              <button onClick={() => removeEvent(e.id)} aria-label="삭제" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:text-red-500">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <EventMeta startTime={e.startTime} endTime={e.endTime} location={e.location} className="mt-0.5 text-sm text-slate-500" />
                          {e.memo && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>}
                          {!isPast && <AbsenceControl eventId={e.id} list={absences[e.id] ?? []} onChanged={loadAbsences} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
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
