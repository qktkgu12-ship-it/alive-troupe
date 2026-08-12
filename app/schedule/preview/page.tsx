"use client";

// ⚠️ 임시 디자인 미리보기 페이지 (로그인 불필요, 목업 데이터).
// 실제 조율 상세 UI를 그대로 재현 — 배포 전 삭제 예정.

import { useMemo, useState } from "react";
import { buildMonthGrid, slotEnd, TIME_SLOTS, toDateStr, WEEKDAYS_KO } from "@/lib/utils";

// ---- 실제 페이지와 동일한 시간대 그룹 ----
const hourOf = (s: string) => parseInt(s.slice(0, 2), 10);
const MORNING = TIME_SLOTS.filter((s) => hourOf(s) < 12);
const AFTERNOON = TIME_SLOTS.filter((s) => hourOf(s) >= 12 && hourOf(s) < 18);
const EVENING = TIME_SLOTS.filter((s) => hourOf(s) >= 18);
const SLOT_GROUPS: [string, string[]][] = [
  ["오전", MORNING],
  ["오후", AFTERNOON],
  ["저녁", EVENING],
];

function dateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return { md: `${d.getMonth() + 1}/${d.getDate()}`, dow: WEEKDAYS_KO[d.getDay()] };
}
function fullDateLabel(ds: string) {
  const d = new Date(ds + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
}

function TeamBadge({ team }: { team?: string }) {
  if (!team) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
      {team}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-xs font-bold text-slate-500">
      {name.slice(0, 1)}
    </span>
  );
}

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

// ---- 목업 데이터 ----
type MockAvail = { uid: string; name: string; dates: string[]; slots?: Record<string, string[]> };
const MOCK_MEMBERS: MockAvail[] = [
  { uid: "u1", name: "박상현", dates: ["2026-08-27", "2026-08-28", "2026-08-30"], slots: { "2026-08-30": ["14:00", "15:00", "16:00", "17:00"], "2026-08-27": ["19:00", "20:00", "21:00"] } },
  { uid: "u2", name: "김민지", dates: ["2026-08-28", "2026-08-30", "2026-08-31"], slots: { "2026-08-30": ["15:00", "16:00", "17:00", "18:00"] } },
  { uid: "u3", name: "이준호", dates: ["2026-08-27", "2026-08-30"], slots: { "2026-08-30": ["14:00", "15:00", "16:00"] } },
  { uid: "u4", name: "최유나", dates: ["2026-08-30", "2026-08-31"], slots: { "2026-08-30": ["19:00", "20:00", "21:00"] } },
  { uid: "u5", name: "정우성", dates: ["2026-08-28", "2026-08-29", "2026-08-30"], slots: { "2026-08-30": ["14:00", "15:00", "16:00", "17:00", "18:00"] } },
  { uid: "u6", name: "한소희", dates: ["2026-08-30"] }, // 아무때나
  { uid: "u7", name: "오세훈", dates: ["2026-08-27", "2026-08-28", "2026-08-30", "2026-08-31"], slots: { "2026-08-30": ["15:00", "16:00", "17:00"] } },
];
const DENOM = 9;

export default function CoordPreviewPage() {
  const [mode, setMode] = useState<"open" | "done">("open");
  const [activeDate, setActiveDate] = useState<string | null>("2026-08-30");
  const [cursor] = useState(new Date(2026, 7, 1)); // 2026년 8월 고정
  const year = cursor.getFullYear();
  const month0 = cursor.getMonth();
  const grid = useMemo(() => buildMonthGrid(year, month0), [year, month0]);
  const todayStr = "2026-08-10";

  // 내 가능 시간(편집) 목업 상태
  const [myDates, setMyDates] = useState<string[]>(["2026-08-30"]);
  const [slotsByDate, setSlotsByDate] = useState<Record<string, string[]>>({ "2026-08-30": ["15:00", "16:00", "17:00"] });
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  const coord = {
    title: "8월 정기공연 연습",
    team: "A팀",
    memo: "이번 달 넘버 연습 위주로 잡아요. 가능한 시간 꼭 넣어주세요!",
    deadline: new Date(2026, 7, 20, 23, 0).getTime(),
    confirmedDate: "2026-08-30",
    confirmedStart: "15:00",
    confirmedEnd: "18:00",
  };
  const submitters = MOCK_MEMBERS.length;

  // ---- 집계 (실제 페이지와 동일 로직) ----
  const slotCount = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const a of MOCK_MEMBERS) {
      for (const date of a.dates) {
        const specific = a.slots?.[date];
        const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
        m[date] ??= {};
        for (const s of list) m[date][s] = (m[date][s] ?? 0) + 1;
      }
    }
    return m;
  }, []);
  const dateCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of MOCK_MEMBERS) for (const ds of a.dates) m[ds] = (m[ds] ?? 0) + 1;
    return m;
  }, []);
  const maxDateCount = useMemo(() => Math.max(0, ...Object.values(dateCount)), [dateCount]);
  const denom = DENOM;

  const bestRangeForDate = (date: string): { start: string; end: string; count: number } | null => {
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
  };

  const membersForActive = useMemo(() => {
    if (!activeDate) return [];
    return MOCK_MEMBERS.filter((a) => a.dates.includes(activeDate)).map((a) => ({ uid: a.uid, name: a.name }));
  }, [activeDate]);

  const othersBySlot = useMemo(() => {
    const m: Record<string, number> = {};
    if (!activeDate) return m;
    for (const a of MOCK_MEMBERS) {
      if (a.uid === "u1") continue; // '나' = u1 가정
      if (!a.dates.includes(activeDate)) continue;
      const specific = a.slots?.[activeDate];
      const list = specific && specific.length > 0 ? specific : TIME_SLOTS;
      for (const s of list) m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [activeDate]);

  // ---- 편집 핸들러 (실제 로직 복제) ----
  function tapDate(ds: string) {
    const selected = myDates.includes(ds);
    if (!selected) {
      setMyDates((p) => [...p, ds].sort());
      setActiveDate(ds);
      setRangeAnchor(null);
    } else if (activeDate === ds) {
      removeDate(ds);
    } else {
      setActiveDate(ds);
      setRangeAnchor(null);
    }
  }
  function removeDate(ds: string) {
    setMyDates((p) => p.filter((d) => d !== ds));
    setSlotsByDate((s) => { const n = { ...s }; delete n[ds]; return n; });
    if (activeDate === ds) setActiveDate(null);
  }
  function pickSlot(slot: string) {
    if (!activeDate) return;
    if (rangeAnchor === null) { setRangeAnchor(slot); return; }
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
  }
  function setPreset(slots: string[]) {
    if (!activeDate) return;
    setSlotsByDate((prev) => ({ ...prev, [activeDate]: slots }));
    setRangeAnchor(null);
  }

  const isDone = mode === "done";
  const deadlineStr = "8/20 23:00";

  const accentVars = {
    ["--accent" as string]: "255 11 7",
    ["--accent-fg" as string]: "255 255 255",
    ["--accent-2" as string]: "210 3 0",
  } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-canvas" style={accentVars}>
      {/* 미리보기 전용 툴바 (실제 화면엔 없음) */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span className="font-bold">임시 미리보기</span>
        <span className="text-amber-600">상태:</span>
        <button onClick={() => setMode("open")} className={`rounded-full px-2 py-0.5 font-semibold ${mode === "open" ? "bg-amber-500 text-white" : "bg-white text-amber-700"}`}>진행 중</button>
        <button onClick={() => setMode("done")} className={`rounded-full px-2 py-0.5 font-semibold ${mode === "done" ? "bg-amber-500 text-white" : "bg-white text-amber-700"}`}>확정됨</button>
      </div>

      <div className="mx-auto w-full max-w-md">
        {/* 상단 바 */}
        <header className="sticky top-[37px] z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-2 py-2.5 backdrop-blur">
          <button aria-label="뒤로" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100">
            <span className="text-2xl leading-none">‹</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-bold text-slate-900">{coord.title}</p>
              <TeamBadge team={coord.team} />
            </div>
          </div>
          <button aria-label="삭제" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6" /></svg>
          </button>
        </header>

        {/* 본문 */}
        <div className="space-y-4 p-4">
          {/* 응답 진행 헤더 */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">
                {isDone ? "약속이 확정됐어요" : "단원들의 응답을 기다리고 있어요"}
              </p>
              {maxDateCount > 0 && !isDone && <span className="shrink-0 text-xs text-slate-400">최고 후보 {maxDateCount}명</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((submitters / denom) * 100))}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>응답 <b className="text-accent">{submitters}</b>/{denom}명</span>
              <span>{deadlineStr} 마감</span>
            </div>
            {coord.memo && <p className="border-t border-slate-100 pt-2.5 text-sm text-slate-500">{coord.memo}</p>}
          </div>

          {/* 확정 결과 카드 */}
          {isDone && (() => {
            const cd = new Date(coord.confirmedDate + "T00:00:00");
            const cnt = dateCount[coord.confirmedDate] ?? 0;
            const timeStr = `${coord.confirmedStart}~${coord.confirmedEnd}`;
            return (
              <div className="rounded-2xl bg-accent p-5 text-center text-accent-fg shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)]">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold opacity-90">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-xs">✓</span>
                  약속 확정 완료
                </p>
                <p className="mt-2 text-3xl font-extrabold tracking-tight">{cd.getMonth() + 1}월 {cd.getDate()}일</p>
                <p className="mt-1 text-sm opacity-90">{WEEKDAYS_KO[cd.getDay()]}요일 · {timeStr}</p>
                <p className="mt-0.5 text-xs opacity-75">{cnt}/{denom}명 가능</p>
              </div>
            );
          })()}

          {/* 날짜별 현황 (히트맵) */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">날짜별 현황</h2>
              <div className="flex items-center gap-1">
                <button aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
                <span className="min-w-[84px] text-center text-sm font-semibold text-slate-700">{year}년 {month0 + 1}월</span>
                <button aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
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
                  ? { backgroundColor: `rgba(16,185,129,${0.12 + 0.55 * Math.min(1, ratio)})`, borderColor: `rgba(16,185,129,${0.35 + 0.4 * Math.min(1, ratio)})` }
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
                    {cnt > 0 && <span className="mt-0.5 text-[9px] font-bold text-emerald-700">{cnt}/{denom}</span>}
                  </button>
                );
              }}
            />
            <p className="mt-3 text-xs text-slate-400">날짜를 누르면 그날 가능한 단원과 시간대를 볼 수 있어요.</p>
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
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{cnt}/{denom} 가능</span>
                </div>

                {cnt > 0 ? (
                  <>
                    {best && <p className="text-xs text-slate-500">가장 겹치는 시간 <b className="text-slate-800">{best.start}~{best.end}</b> · {best.count}명</p>}
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
                          <Avatar name={m.name} />
                          <span className="text-sm text-slate-700">{m.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isDone && cnt > 0 && (
                  <button className="btn-accent w-full">이 날짜로 확정하기</button>
                )}
              </div>
            );
          })()}

          {/* 내 가능 시간 수정 */}
          {isDone ? (
            <p className="rounded-xl bg-surface px-3 py-3 text-center text-xs text-slate-400">확정된 조율이라 가능 시간을 수정할 수 없어요.</p>
          ) : (
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">내 가능 시간 수정</h2>
                <div className="flex items-center gap-1">
                  <button aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">‹</button>
                  <button aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">›</button>
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
                <button className="btn-accent">내 시간 저장</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
