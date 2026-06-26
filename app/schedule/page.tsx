"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import Avatar from "@/components/Avatar";
import type { Absence, Availability, ScheduleEvent } from "@/lib/types";
import {
  buildMonthGrid,
  slotEnd,
  TIME_SLOTS,
  toDateStr,
  toYearMonth,
  WEEKDAYS_KO,
} from "@/lib/utils";

type Tab = "coord" | "events";

const TAB_INFO: Record<Tab, { label: string; desc: string }> = {
  coord: { label: "일정 조율", desc: "내 가능 시간을 제출하고, 단원들과 겹치는 시간을 한눈에 확인하세요." },
  events: { label: "확정 일정", desc: "확정된 일정을 확인하세요." },
};

function dateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: WEEKDAYS_KO[d.getDay()] };
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

const AFTERNOON = TIME_SLOTS.slice(0, 12); // 12:00~18:00
const EVENING = TIME_SLOTS.slice(12); // 18:00~24:00

function ScheduleInner() {
  const { user, profile, role } = useAuth();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [tab, setTab] = useState<Tab>("coord");
  const [confirmDraft, setConfirmDraft] = useState<{ date: string; start: string; end: string } | null>(null);
  const [highlightEvent, setHighlightEvent] = useState<string | null>(null);

  // 홈 '다가오는 일정'에서 넘어온 경우: 확정 일정 탭으로 이동 + 해당 일정 강조
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("tab") === "events") setTab("events");
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

  // 내 가능 일정: 월에 상관없이 전체를 한 번에 불러와 누적 유지 (제출 전까지 달을 넘겨도 유지)
  const loadMine = useCallback(async () => {
    if (!user) return;
    const snap = await getDocs(query(collection(db, "availability"), where("uid", "==", user.uid)));
    const dates: string[] = [];
    const slots: Record<string, string[]> = {};
    for (const d of snap.docs) {
      const a = d.data() as Availability;
      for (const dt of a.dates ?? []) dates.push(dt);
      if (a.slots) for (const k in a.slots) slots[k] = a.slots[k];
    }
    setMyDates([...new Set(dates)].sort());
    setSlotsByDate(slots);
    setDirty(false);
  }, [user]);

  const loadAll = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "availability"), where("yearMonth", "==", yearMonth)));
    setAllAvail(snap.docs.map((d) => d.data() as Availability));
  }, [yearMonth]);

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

  // 내 일정은 한 번만 (달 넘겨도 선택 유지)
  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // 다른 단원 현황·확정일정은 보는 달이 바뀌면 새로 로드
  useEffect(() => {
    loadAll();
    loadEvents();
    setActiveDate(null);
    setRangeAnchor(null);
  }, [loadAll, loadEvents]);

  // ----- 내 가능 일정 편집 -----
  // 탭: 미선택 → 선택+열기 / 선택&활성 → 해제 / 선택&비활성 → 열기(편집)
  function tapDate(ds: string) {
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
    if (!activeDate) return;
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
    if (!activeDate) return;
    setSlotsByDate((prev) => ({ ...prev, [activeDate]: slots }));
    setRangeAnchor(null);
    setDirty(true);
  }

  async function saveMine() {
    if (!user) return;
    setSaving(true);
    try {
      const name = profile?.name || profile?.displayName || "";
      const avatar = profile?.avatar || "";
      // 날짜를 월별로 묶어서 각 월 문서에 저장
      const byMonth: Record<string, { dates: string[]; slots: Record<string, string[]> }> = {};
      for (const d of myDates) {
        const ym = d.slice(0, 7);
        (byMonth[ym] ??= { dates: [], slots: {} }).dates.push(d);
        const arr = slotsByDate[d];
        if (arr && arr.length > 0) byMonth[ym].slots[d] = arr;
      }
      const existing = await getDocs(query(collection(db, "availability"), where("uid", "==", user.uid)));
      await Promise.all(
        Object.entries(byMonth).map(([ym, v]) =>
          setDoc(doc(db, "availability", `${user.uid}_${ym}`), {
            uid: user.uid,
            name,
            avatar,
            yearMonth: ym,
            dates: v.dates,
            slots: v.slots,
            updatedAt: Date.now(),
          })
        )
      );
      // 이번에 날짜가 하나도 없는 달의 기존 문서는 삭제
      await Promise.all(
        existing.docs
          .filter((d) => !byMonth[(d.data() as Availability).yearMonth])
          .map((d) => deleteDoc(d.ref))
      );
      setDirty(false);
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  // ----- 전체 현황 집계 -----
  const { slotCount, submitters } = useMemo(() => {
    const slotCount: Record<string, Record<string, number>> = {};
    for (const a of allAvail) {
      for (const date of a.dates ?? []) {
        const specific = a.slots?.[date];
        const list = specific && specific.length > 0 ? specific : TIME_SLOTS; // 아무때나 → 전체
        slotCount[date] ??= {};
        for (const s of list) slotCount[date][s] = (slotCount[date][s] ?? 0) + 1;
      }
    }
    return { slotCount, submitters: allAvail.length };
  }, [allAvail]);

  const recommendations = useMemo(() => {
    const recs: { date: string; start: string; end: string; count: number; len: number }[] = [];
    for (const date in slotCount) {
      const counts = TIME_SLOTS.map((s) => slotCount[date][s] ?? 0);
      const maxC = Math.max(...counts, 0);
      if (maxC <= 0) continue;
      let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] === maxC) {
          if (curStart < 0) curStart = i;
          curLen++;
          if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else { curStart = -1; curLen = 0; }
      }
      recs.push({
        date,
        start: TIME_SLOTS[bestStart],
        end: slotEnd(TIME_SLOTS[bestStart + bestLen - 1]),
        count: maxC,
        len: bestLen,
      });
    }
    recs.sort((a, b) => b.count - a.count || b.len - a.len || a.date.localeCompare(b.date));
    return recs.slice(0, 3);
  }, [slotCount]);

  // 활성 날짜에서 '나 말고' 시간대별 가능 인원
  const othersBySlot = useMemo(() => {
    const m: Record<string, number> = {};
    if (!activeDate) return m;
    for (const a of allAvail) {
      if (a.uid === user?.uid) continue;
      if (!(a.dates ?? []).includes(activeDate)) continue;
      const specific = a.slots?.[activeDate];
      const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
      for (const s of list) m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [activeDate, allAvail, user?.uid]);

  // 활성 날짜에 가능한 단원 (사진·이름, 이름 내림차순)
  const membersForActive = useMemo(() => {
    if (!activeDate) return [];
    const map = new Map<string, { uid: string; name: string; avatar?: string }>();
    for (const a of allAvail) {
      if ((a.dates ?? []).includes(activeDate)) {
        // 본인은 실시간 프로필 사진을 우선 사용 (옛 제출 데이터에 사진이 없어도 바로 보이게)
        const avatar = a.uid === user?.uid ? profile?.avatar || a.avatar : a.avatar;
        map.set(a.uid, { uid: a.uid, name: a.name || "이름없음", avatar });
      }
    }
    return [...map.values()].sort((x, y) => y.name.localeCompare(x.name, "ko"));
  }, [activeDate, allAvail, user?.uid, profile?.avatar]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  function changeMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">일정</h1>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {(["coord", "events"] as Tab[]).map((t) => (
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

      {/* ===== 일정 조율 (전체현황 + 내 가능 일정 통합) ===== */}
      {tab === "coord" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[0.9fr_1.2fr_1fr]">
            {/* 왼쪽: 전체 가능 현황 */}
            <div className="order-3 md:order-1">
              <div className="card h-full space-y-4">
                <div>
                  <h2 className="font-bold">전체 가능 현황</h2>
                  <p className="mt-0.5 text-xs text-slate-400">가능 일정 제출 {submitters}명</p>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-500">🏆 가장 많이 겹치는 시간</p>
                  {recommendations.length === 0 ? (
                    <p className="text-sm text-slate-400">아직 제출된 일정이 없어요.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {recommendations.map((r, i) => {
                        const { md, dow } = dateLabel(r.date);
                        const tone = ["font-bold text-slate-900", "font-medium text-slate-600", "font-normal text-slate-400"][i] ?? "font-normal text-slate-400";
                        return (
                          <div key={r.date} className={`flex items-center gap-2 py-2 text-sm ${tone}`}>
                            <span className="w-4 shrink-0 text-center tabular-nums">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate">{md}({dow}) {r.start}~{r.end}</span>
                            <span className="shrink-0 text-xs">{r.count}명</span>
                            {role === "admin" && (
                              <button
                                onClick={() => setConfirmDraft({ date: r.date, start: r.start, end: r.end })}
                                className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg"
                              >
                                확정
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {activeDate && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-semibold text-slate-500">
                      {dateLabel(activeDate).md}({dateLabel(activeDate).dow}) 가능 단원 {membersForActive.length}명
                    </p>
                    {membersForActive.length === 0 ? (
                      <p className="text-sm text-slate-400">아직 없어요.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {membersForActive.map((m) => (
                          <div key={m.uid} className="flex items-center gap-2">
                            <Avatar src={m.avatar} name={m.name} className="h-7 w-7 text-xs" />
                            <span className="text-sm text-slate-700">{m.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 가운데: 달력 (월 선택 카드 안 + 내 선택만) */}
            <div className="order-1 md:order-2">
              <div className="card h-full">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-slate-900">{year}년 {month0 + 1}월</span>
                  <div className="flex gap-1">
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
                <p className="mt-3 text-xs text-slate-400">날짜를 눌러 선택, 같은 날을 다시 누르면 해제돼요. 달을 넘겨도 선택은 유지됩니다.</p>
              </div>
            </div>

            {/* 오른쪽: 내 시간 선택 */}
            <div className="order-2 md:order-3">
              <div className="card h-full">
                {!activeDate ? (
                  <p className="py-10 text-center text-sm text-slate-400">날짜를 선택하면<br />시간을 고를 수 있어요.</p>
                ) : (
                  <>
                    <h2 className="font-bold">{dateLabel(activeDate).md} ({dateLabel(activeDate).dow}) 시간</h2>
                    <p className="mb-2 mt-1 text-xs text-slate-400">
                      {rangeAnchor ? `${rangeAnchor} 부터… 끝 시간을 누르세요` : "시작 시간을 누르고 끝 시간을 누르면 사이가 채워져요."}
                    </p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {([["오후", AFTERNOON], ["저녁", EVENING], ["하루 종일", [...TIME_SLOTS]], ["해제", []]] as [string, string[]][]).map(([label, slots]) => (
                        <button key={label} onClick={() => setPreset(slots)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">{label}</button>
                      ))}
                    </div>
                    <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                      {TIME_SLOTS.map((s) => {
                        const sel = (slotsByDate[activeDate] ?? []).includes(s);
                        const isAnchor = rangeAnchor === s;
                        const others = othersBySlot[s] ?? 0;
                        return (
                          <button
                            key={s}
                            onClick={() => pickSlot(s)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                              isAnchor ? "border-accent bg-accent text-accent-fg" : sel ? "border-accent/30 bg-accent-soft text-accent" : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <span className="tabular-nums">{s} ~ {slotEnd(s)}</span>
                            <span className="flex items-center gap-2">
                              {others > 0 && <span className={`text-xs ${isAnchor ? "opacity-80" : "text-slate-400"}`}>{others}명</span>}
                              {isAnchor ? <span className="text-xs">시작</span> : sel ? <span className="text-xs">✓</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 제출 바 */}
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-sm text-slate-500">선택한 날짜 <b className="text-accent">{myDates.length}</b>일</span>
            <button onClick={saveMine} disabled={!dirty || saving} className="btn-accent">
              {saving ? "저장 중…" : dirty ? "제출하기" : "제출됨 ✓"}
            </button>
          </div>

          {/* 추천 → 확정 등록 모달 (관리자) */}
          {confirmDraft && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setConfirmDraft(null)}>
              <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <p className="mb-2 px-1 text-sm font-semibold text-white">확정 일정 등록</p>
                <EventForm
                  initial={{ date: confirmDraft.date, startTime: confirmDraft.start, endTime: confirmDraft.end }}
                  onSaved={() => {
                    setConfirmDraft(null);
                    loadEvents();
                    setTab("events");
                  }}
                  onCancel={() => setConfirmDraft(null)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 확정 일정 ===== */}
      {tab === "events" && (
        <EventsSection
          monthLabel={`${year}년 ${month0 + 1}월`}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          yearMonth={yearMonth}
          events={events}
          eventsByDate={eventsByDate}
          grid={grid}
          isAdmin={role === "admin"}
          onChanged={loadEvents}
          highlightId={highlightEvent}
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

// ---------- 일정 등록 폼 (확정 탭 + 추천 확정 공용) ----------
function EventForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: { date: string; startTime: string; endTime: string; title?: string };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState("");
  const [memo, setMemo] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim() || !date) {
      alert("제목과 날짜는 필수예요.");
      return;
    }
    setBusy(true);
    try {
      await setDoc(doc(db, "events", crypto.randomUUID()), {
        title: title.trim(),
        date,
        startTime,
        endTime,
        location,
        memo,
        createdAt: Date.now(),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 border-dashed">
      <div>
        <label className="label">제목</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 1막 런스루" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">날짜</label>
          <input type="date" className="input !px-2" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">시작</label>
          <input type="time" className="input !px-2" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div>
          <label className="label">종료</label>
          <input type="time" className="input !px-2" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      {more ? (
        <>
          <div>
            <label className="label">장소</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="연습실 등" />
          </div>
          <div>
            <label className="label">메모·준비물</label>
            <textarea className="input min-h-[60px]" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="준비물, 전달사항 등" />
          </div>
        </>
      ) : (
        <button onClick={() => setMore(true)} className="text-xs font-medium text-slate-500 hover:underline">+ 장소·메모 추가</button>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-accent flex-1">{busy ? "등록 중…" : "등록"}</button>
        <button onClick={onCancel} className="btn-ghost">취소</button>
      </div>
    </div>
  );
}

// ---------- 확정 일정 (왼쪽 달력 + 오른쪽 리스트) ----------
function EventsSection({
  monthLabel,
  onPrev,
  onNext,
  yearMonth,
  events,
  eventsByDate,
  grid,
  isAdmin,
  onChanged,
  highlightId,
}: {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  yearMonth: string;
  events: ScheduleEvent[];
  eventsByDate: Record<string, ScheduleEvent[]>;
  grid: (Date | null)[];
  isAdmin: boolean;
  onChanged: () => void;
  highlightId?: string | null;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(`${yearMonth}-01`);
  const today = toDateStr(new Date());

  const [absences, setAbsences] = useState<Record<string, Absence[]>>({});
  const loadAbsences = useCallback(async () => {
    const entries = await Promise.all(
      events.map(async (e) => {
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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 왼쪽: 달력 (월 선택 카드 안 + 일정 있는 날 동그라미) */}
      <div className="card h-full">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-lg font-bold text-slate-900">{monthLabel}</span>
          <div className="flex gap-1">
            <button onClick={onPrev} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
            <button onClick={onNext} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
          </div>
        </div>
        <CalendarGrid
          grid={grid}
          renderCell={(d) => {
            const ds = toDateStr(d);
            const has = (eventsByDate[ds] ?? []).length > 0;
            return (
              <button
                onClick={() => {
                  if (isAdmin) {
                    setFormDate(ds);
                    setShowForm(true);
                  }
                }}
                className={`flex h-full w-full items-center justify-center rounded-full text-sm transition ${
                  has ? "bg-accent font-bold text-accent-fg" : "text-slate-700"
                } ${isAdmin && !has ? "hover:bg-slate-100" : ""} ${ds === today && !has ? "ring-1 ring-accent" : ""}`}
              >
                {d.getDate()}
              </button>
            );
          }}
        />
        {isAdmin && <p className="mt-3 text-xs text-slate-400">날짜를 누르면 그 날로 등록 폼이 열려요.</p>}
      </div>

      {/* 오른쪽: 일정 리스트 */}
      <div className="card h-full">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">이번 달 일정</h2>
          {isAdmin && (
            <button onClick={() => setShowForm((v) => !v)} className="btn-accent !py-1.5">{showForm ? "닫기" : "+ 추가"}</button>
          )}
        </div>

        {isAdmin && showForm && (
          <div className="mb-3">
            <EventForm
              key={formDate}
              initial={{ date: formDate, startTime: "", endTime: "" }}
              onSaved={() => {
                setShowForm(false);
                onChanged();
              }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">이번 달 확정 일정이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div
                key={e.id}
                id={`ev-${e.id}`}
                className={`flex items-start gap-3 rounded-xl border p-3 transition ${highlightId === e.id ? "border-accent ring-2 ring-accent" : "border-slate-200/70"}`}
              >
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft leading-none text-accent">
                  <span className="text-[10px] font-semibold">{Number(e.date.slice(5, 7))}월</span>
                  <span className="text-base font-extrabold">{Number(e.date.slice(8, 10))}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{e.title}</p>
                  <p className="text-sm text-slate-500">
                    {[e.startTime && `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}`, e.location].filter(Boolean).join(" · ") || "시간·장소 미정"}
                  </p>
                  {e.memo && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>}
                  <AbsenceControl eventId={e.id} list={absences[e.id] ?? []} onChanged={loadAbsences} />
                </div>
                {isAdmin && <button onClick={() => removeEvent(e.id)} className="shrink-0 text-xs text-red-500 hover:underline">삭제</button>}
              </div>
            ))}
          </div>
        )}
      </div>
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
