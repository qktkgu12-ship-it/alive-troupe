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
import { buildMonthGrid, toDateStr, toYearMonth, WEEKDAYS_KO } from "@/lib/utils";

type Tab = "mine" | "all" | "events";

function ScheduleInner() {
  const { user, profile, role } = useAuth();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [tab, setTab] = useState<Tab>("mine");

  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const yearMonth = toYearMonth(cursor);
  const grid = useMemo(() => buildMonthGrid(year, month0), [year, month0]);

  // 내 가능 일정
  const [myDates, setMyDates] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);

  // 전체 가능 현황
  const [allAvail, setAllAvail] = useState<Availability[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // 확정 일정
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  // ----- 데이터 로드 -----
  const loadMine = useCallback(async () => {
    if (!user) return;
    const snap = await getDoc(doc(db, "availability", `${user.uid}_${yearMonth}`));
    setMyDates(snap.exists() ? (snap.data() as Availability).dates ?? [] : []);
    setDirty(false);
  }, [user, yearMonth]);

  const loadAll = useCallback(async () => {
    const q = query(collection(db, "availability"), where("yearMonth", "==", yearMonth));
    const snap = await getDocs(q);
    setAllAvail(snap.docs.map((d) => d.data() as Availability));
  }, [yearMonth]);

  const loadEvents = useCallback(async () => {
    const first = `${yearMonth}-01`;
    const last = `${yearMonth}-31`;
    const q = query(
      collection(db, "events"),
      where("date", ">=", first),
      where("date", "<=", last)
    );
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    setEvents(list);
  }, [yearMonth]);

  useEffect(() => {
    loadMine();
    loadAll();
    loadEvents();
    setSelectedDay(null);
  }, [loadMine, loadAll, loadEvents]);

  // ----- 내 가능 일정 토글/저장 -----
  function toggleMyDate(dateStr: string) {
    setMyDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
    setDirty(true);
  }

  async function saveMine() {
    if (!user) return;
    setSavingAvail(true);
    try {
      const payload: Availability = {
        uid: user.uid,
        name: profile?.name || profile?.displayName || "",
        yearMonth,
        dates: myDates,
        updatedAt: Date.now(),
      };
      await setDoc(doc(db, "availability", `${user.uid}_${yearMonth}`), payload);
      setDirty(false);
      await loadAll();
    } finally {
      setSavingAvail(false);
    }
  }

  // 날짜별 가능 인원 집계
  const countByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of allAvail) {
      for (const d of a.dates ?? []) {
        (map[d] ??= []).push(a.name || "이름없음");
      }
    }
    return map;
  }, [allAvail]);

  const totalMembers = allAvail.length;

  // 날짜별 확정 일정 매핑
  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {};
    for (const e of events) (map[e.date] ??= []).push(e);
    return map;
  }, [events]);

  function changeMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  const todayStr = toDateStr(new Date());

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">일정</h1>
      </div>

      {/* 월 이동 */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => changeMonth(-1)} className="btn-ghost !px-3">‹</button>
        <span className="w-32 text-center text-lg font-bold">
          {year}년 {month0 + 1}월
        </span>
        <button onClick={() => changeMonth(1)} className="btn-ghost !px-3">›</button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {([
          ["mine", "내 가능 일정"],
          ["all", "전체 가능 현황"],
          ["events", "확정 일정"],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 transition ${
              tab === t ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ===== 내 가능 일정 ===== */}
      {tab === "mine" && (
        <div className="card">
          <p className="mb-3 text-sm text-slate-500">
            참여 가능한 날짜를 눌러 표시하세요. 언제든 다시 눌러 해제할 수 있습니다.
          </p>
          <CalendarGrid
            grid={grid}
            renderCell={(d) => {
              const ds = toDateStr(d);
              const on = myDates.includes(ds);
              return (
                <button
                  onClick={() => toggleMyDate(ds)}
                  className={`flex h-full w-full flex-col items-center justify-center rounded-lg text-sm transition ${
                    on
                      ? "bg-accent font-bold text-accent-fg"
                      : "hover:bg-slate-100"
                  } ${ds === todayStr && !on ? "ring-1 ring-accent" : ""}`}
                >
                  {d.getDate()}
                </button>
              );
            }}
          />
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-slate-500">
              선택한 날짜 <b className="text-accent">{myDates.length}</b>일
            </span>
            <button onClick={saveMine} disabled={!dirty || savingAvail} className="btn-accent">
              {savingAvail ? "저장 중…" : dirty ? "저장하기" : "저장됨 ✓"}
            </button>
          </div>
        </div>
      )}

      {/* ===== 전체 가능 현황 ===== */}
      {tab === "all" && (
        <div className="card">
          <p className="mb-3 text-sm text-slate-500">
            색이 진할수록 가능한 단원이 많은 날입니다. 날짜를 누르면 명단이 보여요.
            (가능 일정을 제출한 단원 {totalMembers}명)
          </p>
          <CalendarGrid
            grid={grid}
            renderCell={(d) => {
              const ds = toDateStr(d);
              const names = countByDate[ds] ?? [];
              const ratio = totalMembers ? names.length / totalMembers : 0;
              const isSel = selectedDay === ds;
              return (
                <button
                  onClick={() => setSelectedDay(isSel ? null : ds)}
                  className={`flex h-full w-full flex-col items-center justify-center rounded-lg text-sm transition ${
                    isSel ? "ring-2 ring-accent" : "hover:bg-slate-100"
                  }`}
                  style={
                    names.length
                      ? { backgroundColor: `rgb(var(--accent) / ${0.15 + ratio * 0.65})`, color: ratio > 0.5 ? "rgb(var(--accent-fg))" : undefined }
                      : undefined
                  }
                >
                  <span>{d.getDate()}</span>
                  {names.length > 0 && (
                    <span className="text-[10px] font-bold leading-none">{names.length}</span>
                  )}
                </button>
              );
            }}
          />
          {selectedDay && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-semibold">
                {selectedDay} 가능 단원 ({(countByDate[selectedDay] ?? []).length}명)
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(countByDate[selectedDay] ?? []).length === 0 ? (
                  <span className="text-sm text-slate-400">아직 없음</span>
                ) : (
                  (countByDate[selectedDay] ?? []).map((n, i) => (
                    <span key={i} className="chip">{n}</span>
                  ))
                )}
              </div>
            </div>
          )}
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
function CalendarGrid({
  grid,
  renderCell,
}: {
  grid: (Date | null)[];
  renderCell: (d: Date) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-xs font-semibold text-slate-400">
        {WEEKDAYS_KO.map((w, i) => (
          <div key={w} className={i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((d, i) => (
          <div key={i} className="aspect-square">
            {d ? renderCell(d) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 확정 일정 섹션 ----------
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
      const id = crypto.randomUUID();
      await setDoc(doc(db, "events", id), { ...form, createdAt: Date.now() });
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
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <span className="text-xs font-bold">{e.date.slice(5).replace("-", "/")}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.title}</p>
                <p className="text-sm text-slate-500">
                  {[e.startTime && `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}`, e.location].filter(Boolean).join(" · ") || "시간·장소 미정"}
                </p>
                {e.memo && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>}
              </div>
              {isAdmin && (
                <button onClick={() => removeEvent(e.id)} className="btn-danger shrink-0">삭제</button>
              )}
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
