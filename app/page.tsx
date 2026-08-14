"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import DateBadge from "@/components/DateBadge";
import EventMeta from "@/components/EventMeta";
import { ProfileName } from "@/components/ProfileViewer";
import { ArchiveIcon, FolderIcon } from "@/components/Icons";
import { boardCategoryLabel, type Post, type ScheduleEvent } from "@/lib/types";
import { relativeTime, toDateStr, WEEKDAYS_KO } from "@/lib/utils";

// 팀 순서 기반 색상 팔레트 (schedule·members·admin 동일)
const TEAM_PALETTE: { border: string; color: string }[] = [
  { border: "rgb(94,234,212)", color: "rgb(15,118,110)" },
  { border: "rgb(196,181,253)", color: "rgb(109,40,217)" },
];
function getTeamColor(team: string | undefined, teams: string[]) {
  if (!team) return null;
  const idx = teams.indexOf(team);
  if (idx < 0) return null;
  return TEAM_PALETTE[idx] ?? { border: "rgb(148,163,184)", color: "rgb(100,116,139)" };
}

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
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS_KO[now.getDay()]})`;
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);

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
          .slice(0, 30);
        setUpcoming(list);
      })
      .catch(() => setUpcoming([]));

    // 전체글 (모든 게시판 최신글)
    getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(6)))
      .then((snap) => setRecentPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))))
      .catch(() => setRecentPosts([]));
  }, []);

  // 내 팀 일정만 (공통 + 내 팀). 팀 미지정이거나 관리자면 전체
  const myTeam = role === "admin" ? "" : (profile?.team ?? "");
  const shownEvents = upcoming.filter((e) => !myTeam || !e.team || e.team === myTeam).slice(0, 4);

  return (
    <div className="space-y-8">
      {/* 인사 — 담백하게 */}
      <header className="pt-1">
        <p className="text-xs font-medium text-slate-400">{todayLabel}</p>
        <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">Today, Here, Right now!</p>
      </header>

      {/* 다가오는 확정 일정 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">다가오는 일정</h2>
          <Link href="/schedule" aria-label="전체 보기" className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </Link>
        </div>
        {shownEvents.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {/* 가장 가까운 일정 — 크게 */}
            {(() => {
              const e = shownEvents[0];
              const dt = parseDate(e.date);
              return (
                <Link
                  href={`/schedule?tab=events&event=${e.id}&date=${e.date}`}
                  className="card relative flex items-start gap-4 border-2 border-accent/50 transition hover:border-accent/75"
                  style={{ boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 10px 30px rgb(var(--accent) / 0.18)" }}
                >
                  <span className="absolute right-4 top-4 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">{ddayLabel(e.date)}</span>
                  <DateBadge day={dt.getDate()} weekday={WEEKDAYS_KO[dt.getDay()]} size="md" />
                  <div className="min-w-0 flex-1 pr-12">
                    <p className="mb-0.5 text-xs text-slate-400">
                      {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
                    </p>
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-lg font-bold text-slate-900">{e.title}</h3>
                      {e.team && (() => {
                        const c = getTeamColor(e.team, teams);
                        return (
                          <span
                            style={c ? { borderColor: c.border, color: c.color } : {}}
                            className={`inline-flex shrink-0 items-center rounded-full border bg-white px-2 py-0.5 text-[11px] font-semibold ${!c ? "border-slate-200 text-slate-500" : ""}`}
                          >
                            {e.team}
                          </span>
                        );
                      })()}
                    </div>
                    <EventMeta startTime={e.startTime} endTime={e.endTime} location={e.location} className="mt-1 text-sm text-slate-500" />
                    {e.memo && (
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>
                    )}
                  </div>
                </Link>
              );
            })()}

            {/* 그다음 일정 2~3개 — 아주 작게 */}
            {shownEvents.length > 1 && (
              <div className="px-1">
                {shownEvents.slice(1, 4).map((e) => {
                  const dt = parseDate(e.date);
                  return (
                    <Link
                      key={e.id}
                      href={`/schedule?tab=events&event=${e.id}&date=${e.date}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-black/[0.03]"
                    >
                      <span className="shrink-0 font-bold text-slate-800">{dt.getMonth() + 1}.{dt.getDate()}</span>
                      <span className="shrink-0 text-slate-400">{WEEKDAYS_KO[dt.getDay()]}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{e.title}</span>
                      {e.team && (() => {
                        const c = getTeamColor(e.team, teams);
                        return (
                          <span
                            style={c ? { color: c.color } : {}}
                            className={`shrink-0 text-xs font-semibold ${!c ? "text-slate-400" : ""}`}
                          >
                            {e.team}
                          </span>
                        );
                      })()}
                      <span className="shrink-0 text-slate-400">{ddayLabel(e.date)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 바로가기 */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">바로가기</h2>
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map(({ href, title, desc, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex aspect-square flex-col justify-between rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-10px_rgba(16,24,40,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_rgba(16,24,40,0.18)]"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-white transition group-hover:brightness-110">
                <Icon className="h-6 w-6" />
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
          <h2 className="text-lg font-bold text-slate-900">전체글</h2>
          <Link href="/board" aria-label="게시판" className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
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
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:inline"><ProfileName uid={p.authorUid} name={p.authorName} /></span>
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
          <h2 className="mb-3 text-lg font-bold text-slate-900">관리</h2>
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
