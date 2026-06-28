"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import EventMeta from "@/components/EventMeta";
import { ArchiveIcon, FolderIcon } from "@/components/Icons";
import { boardCategoryLabel, type Post, type ScheduleEvent } from "@/lib/types";
import { relativeTime, toDateStr, WEEKDAYS_KO } from "@/lib/utils";

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function ddayLabel(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dt = parseDate(dateStr);
  dt.setHours(0, 0, 0, 0);
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff > 1) return `D-${diff}`;
  return `D+${-diff}`;
}
// 종료시간(없으면 시작시간, 둘 다 없으면 그날 자정)이 지났으면 '지난 일정'
function eventPassed(e: ScheduleEvent, nowMs: number) {
  const dt = parseDate(e.date);
  const end = e.endTime || e.startTime;
  if (end) {
    const [h, m] = end.split(":").map(Number);
    dt.setHours(h || 0, m || 0, 0, 0);
  } else {
    dt.setHours(23, 59, 59, 999);
  }
  return dt.getTime() < nowMs;
}

const FEATURES = [
  { href: "/archive", title: "아카이브", desc: "공연 · 연습 기록", Icon: ArchiveIcon },
  { href: "/audio", title: "자료실", desc: "음원 · 악보 · 문서", Icon: FolderIcon },
];

function HomeInner() {
  const { profile, role } = useAuth();
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS_KO[now.getDay()]})`;
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [weekEventDates, setWeekEventDates] = useState<Set<string>>(new Set());

  const todayDs = toDateStr(now);
  // 이번 주(일~토) 7일
  const weekDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, []);

  useEffect(() => {
    // 이번 주 일정 있는 날(점 표시용)
    const ws = toDateStr(weekDays[0]);
    const we = toDateStr(weekDays[6]);
    getDocs(query(collection(db, "events"), where("date", ">=", ws), where("date", "<=", we)))
      .then((snap) => setWeekEventDates(new Set(snap.docs.map((d) => (d.data() as ScheduleEvent).date))))
      .catch(() => setWeekEventDates(new Set()));
  }, [weekDays]);

  useEffect(() => {
    const today = toDateStr(new Date());
    const q = query(
      collection(db, "events"),
      where("date", ">=", today),
      orderBy("date", "asc")
    );
    const nowMs = Date.now();
    getDocs(q)
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
          .filter((e) => !eventPassed(e, nowMs)) // 시간이 지난 일정은 제외
          // 날짜순, 같은 날짜는 시작시간 빠른 순
          .sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")))
          .slice(0, 4);
        setUpcoming(list);
      })
      .catch(() => setUpcoming([]));

    // 전체글 (모든 게시판 최신글)
    getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(6)))
      .then((snap) => setRecentPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))))
      .catch(() => setRecentPosts([]));
  }, []);

  return (
    <div className="space-y-8">
      {/* 인사 — 담백하게 */}
      <header className="pt-1">
        <p className="text-xs font-medium text-slate-400">{todayLabel}</p>
        <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        <p className="mt-1 text-sm italic text-slate-400">Today here, Right now!</p>
      </header>

      {/* 이번 주 데이 스트립 (배경 위에 슬림하게) */}
      <div className="flex justify-between gap-0.5 px-1">
        {weekDays.map((d) => {
          const ds = toDateStr(d);
          const isToday = ds === todayDs;
          const has = weekEventDates.has(ds);
          return (
            <Link
              key={ds}
              href={`/schedule?tab=events&date=${ds}`}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1 transition hover:bg-black/[0.03]"
            >
              <span className={`text-[10px] font-medium ${isToday ? "text-accent" : "text-slate-400"}`}>{WEEKDAYS_KO[d.getDay()]}</span>
              <span className={`grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold ${isToday ? "bg-accent text-accent-fg" : "text-slate-600"}`}>
                {d.getDate()}
              </span>
              <span className={`h-1 w-1 rounded-full ${has ? "bg-accent" : "bg-transparent"}`} />
            </Link>
          );
        })}
      </div>

      {/* 다가오는 확정 일정 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">다가오는 일정</h2>
          <Link href="/schedule" className="text-sm font-medium text-accent hover:underline">
            전체 보기 →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>
        ) : (
          (() => {
            // 가까운 3개를 날짜별로 묶기 (확정일정과 동일한 모양)
            const top = upcoming.slice(0, 3);
            const groups: [string, ScheduleEvent[]][] = [];
            for (const e of top) {
              const last = groups[groups.length - 1];
              if (last && last[0] === e.date) last[1].push(e);
              else groups.push([e.date, [e]]);
            }
            return (
              <div className="space-y-4">
                {groups.map(([date, evs]) => {
                  const d = parseDate(date);
                  return (
                    <div key={date} className="flex gap-3">
                      {/* 날짜 (왼쪽) */}
                      <div className="w-9 shrink-0 pt-1.5 text-center leading-none">
                        {d.getMonth() !== now.getMonth() && (
                          <p className="text-[10px] text-slate-300">{d.getMonth() + 1}월</p>
                        )}
                        <p className="text-[11px] font-medium text-slate-400">{WEEKDAYS_KO[d.getDay()]}</p>
                        <p className="mt-1 text-2xl font-extrabold text-accent">{d.getDate()}</p>
                      </div>
                      {/* 카드들 (첫 일정만 조금 크게) */}
                      <div className="min-w-0 flex-1 space-y-2">
                        {evs.map((e) => {
                          const big = e.id === upcoming[0].id;
                          return (
                            <Link
                              key={e.id}
                              href={`/schedule?tab=events&event=${e.id}&date=${e.date}`}
                              className={`relative block rounded-xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05),0_6px_16px_-8px_rgba(16,24,40,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(16,24,40,0.18)] ${
                                big ? "p-4 ring-1 ring-accent/15" : "p-3"
                              }`}
                            >
                              <span className="absolute right-3 top-3 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">{ddayLabel(e.date)}</span>
                              <p className={`truncate pr-12 font-bold text-slate-900 ${big ? "text-lg" : "text-[15px]"}`}>{e.title}</p>
                              <EventMeta startTime={e.startTime} endTime={e.endTime} location={e.location} className="mt-1 text-sm text-slate-500" />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </section>

      {/* 바로가기 */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">바로가기</h2>
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map(({ href, title, desc, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-10px_rgba(16,24,40,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_rgba(16,24,40,0.18)]"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent transition group-hover:bg-accent group-hover:text-accent-fg">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 전체글 (모든 게시판 최신글) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">전체글</h2>
          <Link href="/board" className="text-sm font-medium text-accent hover:underline">
            게시판 →
          </Link>
        </div>
        <div className="card !p-0">
          {recentPosts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">아직 작성된 글이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentPosts.map((p) => (
                <li key={p.id}>
                  <Link href={`/board/${p.id}`} className="flex items-center gap-2 px-4 py-3 transition hover:bg-slate-50">
                    {p.isNotice ? (
                      <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">공지</span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {boardCategoryLabel(p.board)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.title}</span>
                    {(p.commentCount ?? 0) > 0 && (
                      <span className="shrink-0 text-xs font-semibold text-accent">[{p.commentCount}]</span>
                    )}
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{p.authorName}</span>
                    <span className="shrink-0 text-xs text-slate-300">{relativeTime(p.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {role === "admin" && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">관리</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin" className="btn-accent">관리 페이지</Link>
          </div>
        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Guard>
      <HomeInner />
    </Guard>
  );
}
