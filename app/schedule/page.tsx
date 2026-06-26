"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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

type Tab = "mine" | "all" | "events";

const TAB_INFO: Record<Tab, { label: string; desc: string }> = {
  mine: { label: "내 가능 일정", desc: "가능한 날짜를 고르고, 시간을 칠해 제출하세요." },
  all: { label: "전체 가능 현황", desc: "단원들이 가장 많이 겹치는 날·시간을 확인하세요." },
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
  const [tab, setTab] = useState<Tab>("all");

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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // 확정 일정
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  const loadMine = useCallback(async () => {
    if (!user) return;
    const snap = await getDoc(doc(db, "availability", `${user.uid}_${yearMonth}`));
    if (snap.exists()) {
      const d = snap.data() as Availability;
      setMyDates(d.dates ?? []);
      setSlotsByDate(d.slots ?? {});
    } else {
      setMyDates([]);
      setSlotsByDate({});
    }
    setDirty(false);
  }, [user, yearMonth]);

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

  useEffect(() => {
    loadMine();
    loadAll();
    loadEvents();
    setSelectedDay(null);
    setActiveDate(null);
    setRangeAnchor(null);
  }, [loadMine, loadAll, loadEvents]);

  // ----- 내 가능 일정 편집 -----
  function selectDate(ds: string) {
    setMyDates((prev) => (prev.includes(ds) ? prev : [...prev, ds].sort()));
    setActiveDate(ds);
    setRangeAnchor(null);
    setDirty(true);
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
      const slots: Record<string, string[]> = {};
      for (const d of myDates) {
        const arr = slotsByDate[d];
        if (arr && arr.length > 0) slots[d] = arr;
      }
      const payload: Availability = {
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        yearMonth,
        dates: myDates,
        slots,
        updatedAt: Date.now(),
      };
      await setDoc(doc(db, "availability", `${user.uid}_${yearMonth}`), payload);
      setDirty(false);
      await loadAll();
    } finally {
      setSaving(false);
    }
  }

  // ----- 전체 현황 집계 -----
  const { dayMax, slotCount, slotNames, submitters } = useMemo(() => {
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
    const dayMax: Record<string, number> = {};
    for (const date in slotCount) {
      const vals = Object.values(slotCount[date]);
      dayMax[date] = vals.length ? Math.max(...vals) : 0;
    }
    return { dayMax, slotCount, slotNames, submitters: allAvail.length };
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

  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  function changeMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  const sortedMyDates = useMemo(() => [...myDates].sort(), [myDates]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">일정</h1>

      {/* 월 이동 */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => changeMonth(-1)} className="btn-ghost !px-3">‹</button>
        <span className="w-32 text-center text-lg font-bold">{year}년 {month0 + 1}월</span>
        <button onClick={() => changeMonth(1)} className="btn-ghost !px-3">›</button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {(["all", "mine", "events"] as Tab[]).map((t) => (
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

      {/* ===== 전체 가능 현황 ===== */}
      {tab === "all" && (
        <div className="space-y-4">
          {/* 추천 */}
          <div className="card bg-accent-soft/40">
            <h2 className="mb-2 text-sm font-bold text-slate-700">🏆 가장 많이 겹치는 시간 (제출 {submitters}명)</h2>
            {recommendations.length === 0 ? (
              <p className="py-2 text-sm text-slate-400">아직 제출된 가능 일정이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {recommendations.map((r, i) => {
                  const { md, dow } = dateLabel(r.date);
                  return (
                    <div key={r.date} className="flex items-center gap-3 rounded-lg bg-white p-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900">{md} ({dow}) · {r.start}~{r.end}</p>
                        <p className="text-xs text-slate-400">{r.count}명 가능</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 히트맵 달력 */}
          <div className="card">
            <p className="mb-3 text-sm text-slate-500">색이 진할수록 가능한 단원이 많은 날이에요. 날짜를 누르면 시간대별 인원이 보여요.</p>
            <CalendarGrid
              grid={grid}
              renderCell={(d) => {
                const ds = toDateStr(d);
                const cnt = dayMax[ds] ?? 0;
                const ratio = submitters ? cnt / submitters : 0;
                const isSel = selectedDay === ds;
                return (
                  <button
                    onClick={() => setSelectedDay(isSel ? null : ds)}
                    className={`flex h-full w-full flex-col items-center justify-center rounded-lg text-sm transition ${isSel ? "ring-2 ring-accent" : "hover:bg-slate-100"}`}
                    style={cnt ? { backgroundColor: `rgb(var(--accent) / ${0.15 + ratio * 0.7})`, color: ratio > 0.5 ? "rgb(var(--accent-fg))" : undefined } : undefined}
                  >
                    <span>{d.getDate()}</span>
                    {cnt > 0 && <span className="text-[10px] font-bold leading-none">{cnt}</span>}
                  </button>
                );
              }}
            />
          </div>

          {/* 선택한 날 시간대별 상세 */}
          {selectedDay && (
            <div className="card">
              <h3 className="mb-2 font-semibold">
                {dateLabel(selectedDay).md} ({dateLabel(selectedDay).dow}) 시간대별 가능 인원
              </h3>
              {(() => {
                const sc = slotCount[selectedDay] ?? {};
                const active = TIME_SLOTS.filter((s) => (sc[s] ?? 0) > 0);
                if (active.length === 0) return <p className="py-3 text-sm text-slate-400">이 날 가능한 단원이 없습니다.</p>;
                return (
                  <div className="space-y-1.5">
                    {active.map((s) => (
                      <div key={s} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0 tabular-nums text-slate-500">{s}~{slotEnd(s)}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-accent" style={{ width: `${submitters ? ((sc[s] ?? 0) / submitters) * 100 : 0}%` }} />
                        </div>
                        <span className="w-10 shrink-0 text-right font-medium text-slate-600">{sc[s] ?? 0}명</span>
                      </div>
                    ))}
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                      {[...new Set(Object.values(slotNames[selectedDay] ?? {}).flat())].map((n) => (
                        <span key={n} className="chip">{n}</span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ===== 내 가능 일정 ===== */}
      {tab === "mine" && (
        <div className="grid gap-4 md:grid-cols-[0.95fr_1.15fr_0.95fr]">
          {/* 요약 + 제출 (PC 왼쪽 / 모바일 맨 아래) */}
          <div className="order-3 md:order-1">
            <div className="card md:sticky md:top-20">
              <h2 className="font-bold">내 가능 일정</h2>
              <p className="mb-3 mt-0.5 text-xs text-slate-400">선택한 날짜 {myDates.length}일</p>
              {sortedMyDates.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">달력에서 가능한 날짜를 골라주세요.</p>
              ) : (
                <div className="space-y-1.5">
                  {sortedMyDates.map((d) => {
                    const ranges = slotRanges(slotsByDate[d] ?? []);
                    const { md, dow } = dateLabel(d);
                    return (
                      <div key={d} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${activeDate === d ? "bg-accent-soft" : "bg-slate-50"}`}>
                        <button onClick={() => { setActiveDate(d); setRangeAnchor(null); }} className="min-w-0 flex-1 text-left">
                          <span className="font-medium text-slate-800">{md}({dow})</span>
                          <span className="ml-1 text-xs text-slate-500">{ranges.length ? ranges.join(", ") : "아무때나"}</span>
                        </button>
                        <button onClick={() => removeDate(d)} aria-label="삭제" className="shrink-0 text-base leading-none text-slate-400 hover:text-red-500">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={saveMine} disabled={!dirty || saving} className="btn-accent mt-4 w-full">
                {saving ? "저장 중…" : dirty ? "제출하기" : "제출됨 ✓"}
              </button>
            </div>
          </div>

          {/* 달력 (가운데) */}
          <div className="order-1 md:order-2">
            <div className="card">
              <p className="mb-3 text-sm text-slate-500">가능한 <b className="text-slate-700">날짜</b>를 선택하세요.</p>
              <CalendarGrid
                grid={grid}
                renderCell={(d) => {
                  const ds = toDateStr(d);
                  const on = myDates.includes(ds);
                  const active = activeDate === ds;
                  return (
                    <button
                      onClick={() => selectDate(ds)}
                      className={`flex h-full w-full items-center justify-center rounded-lg text-sm transition ${on ? "bg-accent font-bold text-accent-fg" : "hover:bg-slate-100"} ${active ? "ring-2 ring-accent ring-offset-1" : ds === todayStr && !on ? "ring-1 ring-accent" : ""}`}
                    >
                      {d.getDate()}
                    </button>
                  );
                }}
              />
            </div>
          </div>

          {/* 시간 선택 (오른쪽) */}
          <div className="order-2 md:order-3">
            <div className="card md:sticky md:top-20">
              {!activeDate ? (
                <p className="py-10 text-center text-sm text-slate-400">날짜를 선택하면<br />시간을 고를 수 있어요.</p>
              ) : (
                <>
                  <h2 className="font-bold">{dateLabel(activeDate).md} ({dateLabel(activeDate).dow}) 시간 선택</h2>
                  <p className="mb-2 mt-1 text-xs text-slate-400">
                    {rangeAnchor ? `${rangeAnchor} 부터… 끝 시간을 누르세요` : "시작 시간을 누르고 끝 시간을 누르면 사이가 채워져요."}
                  </p>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {([["오후", AFTERNOON], ["저녁", EVENING], ["하루 종일", [...TIME_SLOTS]], ["해제", []]] as [string, string[]][]).map(([label, slots]) => (
                      <button key={label} onClick={() => setPreset(slots)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                    {TIME_SLOTS.map((s) => {
                      const sel = (slotsByDate[activeDate] ?? []).includes(s);
                      const isAnchor = rangeAnchor === s;
                      return (
                        <button
                          key={s}
                          onClick={() => pickSlot(s)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                            isAnchor ? "border-accent bg-accent text-accent-fg" : sel ? "border-accent/30 bg-accent-soft text-accent" : "border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          <span className="tabular-nums">{s} ~ {slotEnd(s)}</span>
                          {isAnchor ? <span className="text-xs">시작</span> : sel ? <span className="text-xs">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 확정 일정 ===== */}
      {tab === "events" && (
        <EventsSection
          yearMonth={yearMonth}
          events={events}
          eventsByDate={eventsByDate}
          grid={grid}
          isAdmin={role === "admin"}
          onChanged={loadEvents}
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
