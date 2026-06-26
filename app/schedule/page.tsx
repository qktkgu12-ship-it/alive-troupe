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
import type { Availability, ScheduleEvent } from "@/lib/types";
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

function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-center gap-4">
      <button onClick={onPrev} className="btn-ghost !px-3">‹</button>
      <span className="w-32 text-center text-lg font-bold">{label}</span>
      <button onClick={onNext} className="btn-ghost !px-3">›</button>
    </div>
  );
}

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
  const { slotCount, slotNames, submitters } = useMemo(() => {
    const slotCount: Record<string, Record<string, number>> = {};
    const slotNames: Record<string, Record<string, string[]>> = {};
    for (const a of allAvail) {
      const name = a.name || "이름없음";
      for (const date of a.dates ?? []) {
        const specific = a.slots?.[date];
        const list = specific && specific.length > 0 ? specific : TIME_SLOTS; // 아무때나 → 전체
        slotCount[date] ??= {};
        slotNames[date] ??= {};
        for (const s of list) {
          slotCount[date][s] = (slotCount[date][s] ?? 0) + 1;
          (slotNames[date][s] ??= []).push(name);
        }
      }
    }
    return { slotCount, slotNames, submitters: allAvail.length };
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

  const namesForActive = useMemo(
    () => (activeDate ? [...new Set(Object.values(slotNames[activeDate] ?? {}).flat())] : []),
    [activeDate, slotNames]
  );

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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {activeDate && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="mb-1.5 text-xs font-semibold text-slate-500">{dateLabel(activeDate).md}({dateLabel(activeDate).dow}) 가능 단원</p>
                    {namesForActive.length === 0 ? (
                      <p className="text-sm text-slate-400">아직 없어요.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">{namesForActive.map((n) => <span key={n} className="chip">{n}</span>)}</div>
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
        </div>
      )}

      {/* ===== 확정 일정 ===== */}
      {tab === "events" && (
        <div>
          <MonthNav label={`${year}년 ${month0 + 1}월`} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} />
          <EventsSection
            yearMonth={yearMonth}
            events={events}
            eventsByDate={eventsByDate}
            grid={grid}
            isAdmin={role === "admin"}
            onChanged={loadEvents}
          />
        </div>
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

// ---------- 확정 일정 ----------
function EventsSection({
  yearMonth,
  events,
  eventsByDate,
  grid,
  isAdmin,
  onChanged,
}: {
  yearMonth: string;
  events: ScheduleEvent[];
  eventsByDate: Record<string, ScheduleEvent[]>;
  grid: (Date | null)[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const blank = { title: "", date: `${yearMonth}-01`, startTime: "", endTime: "", location: "", memo: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  async function addEvent() {
    if (!form.title || !form.date) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "events", crypto.randomUUID()), { ...form, createdAt: Date.now() });
      setForm({ ...blank });
      setShowForm(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(id: string) {
    if (!confirm("이 일정을 삭제할까요?")) return;
    await deleteDoc(doc(db, "events", id));
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <CalendarGrid
          grid={grid}
          renderCell={(d) => {
            const ds = toDateStr(d);
            const has = (eventsByDate[ds] ?? []).length > 0;
            return (
              <div className={`flex h-full w-full flex-col items-center justify-center rounded-lg text-sm ${has ? "bg-accent-soft font-bold text-accent" : "text-slate-600"}`}>
                <span>{d.getDate()}</span>
                {has && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
              </div>
            );
          }}
        />
      </div>

      {isAdmin && (
        <div>
          {showForm ? (
            <div className="card space-y-3">
              <div>
                <label className="label">제목</label>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 1막 런스루" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">날짜</label>
                  <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <label className="label">장소</label>
                  <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="연습실 등" />
                </div>
                <div>
                  <label className="label">시작 시간</label>
                  <input type="time" className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div>
                  <label className="label">종료 시간</label>
                  <input type="time" className="input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">메모·준비물</label>
                <textarea className="input min-h-[72px]" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="준비물, 전달사항 등" />
              </div>
              <div className="flex gap-2">
                <button onClick={addEvent} disabled={busy} className="btn-accent flex-1">{busy ? "등록 중…" : "일정 등록"}</button>
                <button onClick={() => setShowForm(false)} className="btn-ghost">취소</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)} className="btn-accent w-full">+ 확정 일정 등록</button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {events.length === 0 ? (
          <p className="card text-center text-sm text-slate-400">이번 달 확정 일정이 없습니다.</p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="card flex items-start gap-3 !p-4">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft leading-none text-accent">
                <span className="text-[10px] font-semibold">{Number(e.date.slice(5, 7))}월</span>
                <span className="text-lg font-extrabold">{Number(e.date.slice(8, 10))}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.title}</p>
                <p className="text-sm text-slate-500">
                  {[e.startTime && `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}`, e.location].filter(Boolean).join(" · ") || "시간·장소 미정"}
                </p>
                {e.memo && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>}
              </div>
              {isAdmin && <button onClick={() => removeEvent(e.id)} className="btn-danger shrink-0">삭제</button>}
            </div>
          ))
        )}
      </div>
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
