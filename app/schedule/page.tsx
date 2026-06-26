"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  }, [loadMine, loadAll, loadEvents]);

  // ----- 내 가능 일정 편집 -----
  function toggleMyDate(ds: string) {
    setMyDates((prev) => {
      if (prev.includes(ds)) {
        setSlotsByDate((s) => {
          const n = { ...s };
          delete n[ds];
          return n;
        });
        return prev.filter((d) => d !== ds);
      }
      return [...prev, ds].sort();
    });
    setDirty(true);
  }

  function toggleSlot(date: string, slot: string) {
    setSlotsByDate((prev) => {
      const set = new Set(prev[date] ?? []);
      if (set.has(slot)) set.delete(slot);
      else set.add(slot);
      return { ...prev, [date]: [...set] };
    });
    setDirty(true);
  }

  function toggleColumn(date: string) {
    setSlotsByDate((prev) => {
      const cur = prev[date] ?? [];
      return { ...prev, [date]: cur.length === TIME_SLOTS.length ? [] : [...TIME_SLOTS] };
    });
    setDirty(true);
  }

  function toggleRow(slot: string) {
    const sortedDates = [...myDates].sort();
    const allHave = sortedDates.every((d) => (slotsByDate[d] ?? []).includes(slot));
    setSlotsByDate((prev) => {
      const n = { ...prev };
      for (const d of sortedDates) {
        const set = new Set(n[d] ?? []);
        if (allHave) set.delete(slot);
        else set.add(slot);
        n[d] = [...set];
      }
      return n;
    });
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
        <div className="space-y-4">
          <div className="card">
            <p className="mb-3 text-sm text-slate-500">
              <b className="text-slate-700">1단계.</b> 참여 가능한 날짜를 모두 눌러주세요.
            </p>
            <CalendarGrid
              grid={grid}
              renderCell={(d) => {
                const ds = toDateStr(d);
                const on = myDates.includes(ds);
                return (
                  <button
                    onClick={() => toggleMyDate(ds)}
                    className={`flex h-full w-full items-center justify-center rounded-lg text-sm transition ${on ? "bg-accent font-bold text-accent-fg" : "hover:bg-slate-100"} ${ds === todayStr && !on ? "ring-1 ring-accent" : ""}`}
                  >
                    {d.getDate()}
                  </button>
                );
              }}
            />
          </div>

          {sortedMyDates.length > 0 && (
            <div className="card">
              <p className="mb-1 text-sm text-slate-500">
                <b className="text-slate-700">2단계.</b> 가능한 시간을 칠해주세요. (칸·시간·날짜 머리글을 눌러 한번에 선택)
              </p>
              <p className="mb-3 text-xs text-slate-400">시간을 안 칠한 날은 ‘아무때나 가능’으로 처리돼요.</p>
              <div className="overflow-x-auto">
                <div
                  className="inline-grid gap-px bg-slate-100"
                  style={{ gridTemplateColumns: `3.2rem repeat(${sortedMyDates.length}, minmax(2.6rem, 1fr))` }}
                >
                  <div className="bg-white" />
                  {sortedMyDates.map((d) => {
                    const { md, dow } = dateLabel(d);
                    return (
                      <button key={d} onClick={() => toggleColumn(d)} className="bg-white py-1 text-center text-[11px] font-semibold leading-tight text-slate-600 hover:bg-slate-50">
                        {md}<br /><span className="text-slate-400">{dow}</span>
                      </button>
                    );
                  })}
                  {TIME_SLOTS.map((slot) => (
                    <Fragment key={slot}>
                      <button onClick={() => toggleRow(slot)} className="bg-white pr-1 text-right text-[10px] tabular-nums text-slate-400 hover:bg-slate-50">
                        {slot}
                      </button>
                      {sortedMyDates.map((d) => {
                        const on = (slotsByDate[d] ?? []).includes(slot);
                        return (
                          <button
                            key={d + slot}
                            onClick={() => toggleSlot(d, slot)}
                            className={`h-6 transition ${on ? "bg-accent" : "bg-white hover:bg-accent-soft"}`}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">선택한 날짜 <b className="text-accent">{myDates.length}</b>일</span>
            <button onClick={saveMine} disabled={!dirty || saving} className="btn-accent">
              {saving ? "저장 중…" : dirty ? "제출하기" : "제출됨 ✓"}
            </button>
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
