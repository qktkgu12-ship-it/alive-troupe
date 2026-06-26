"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import { ArchiveIcon, MusicIcon } from "@/components/Icons";
import { BOARD_LABEL, type Post, type ScheduleEvent } from "@/lib/types";
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
function eventMeta(e: ScheduleEvent) {
  const time = e.startTime ? `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}` : "";
  return [time, e.location].filter(Boolean).join(" · ");
}

const FEATURES = [
  { href: "/archive", title: "아카이브", desc: "공연 · 연습 기록", Icon: ArchiveIcon },
  { href: "/audio", title: "음원 자료실", desc: "MR · 가이드", Icon: MusicIcon },
];

function HomeInner() {
  const { profile, role } = useAuth();
  const now = new Date();
  const todayLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS_KO[now.getDay()]})`;
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);

  useEffect(() => {
    const today = toDateStr(new Date());
    const q = query(
      collection(db, "events"),
      where("date", ">=", today),
      orderBy("date", "asc")
    );
    getDocs(q)
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
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
      {/* 인사 */}
      <header className="pt-1">
        <p className="text-xs font-medium text-slate-400">{todayLabel}</p>
        <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        <p className="mt-1 text-sm font-semibold tracking-wide text-accent">Today here, Right now!</p>
      </header>

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
          <div className="space-y-3">
            {/* 가장 가까운 일정 — 강조 카드 */}
            {(() => {
              const e = upcoming[0];
              const dt = parseDate(e.date);
              const meta = eventMeta(e);
              return (
                <Link href="/schedule" className="card flex items-start gap-4 ring-1 ring-accent/15 transition hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]">
                  <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-accent-soft leading-none text-accent">
                    <span className="text-[11px] font-semibold">{dt.getMonth() + 1}월</span>
                    <span className="text-2xl font-extrabold">{dt.getDate()}</span>
                    <span className="mt-0.5 text-[11px] font-medium">{WEEKDAYS_KO[dt.getDay()]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-fg">{ddayLabel(e.date)}</span>
                      <span className="text-xs text-slate-400">
                        {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
                      </span>
                    </div>
                    <h3 className="truncate text-lg font-bold text-slate-900">{e.title}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">{meta || "시간·장소 미정"}</p>
                    {e.memo && (
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{e.memo}</p>
                    )}
                  </div>
                </Link>
              );
            })()}

            {/* 다음 일정들 — 작게 */}
            {upcoming.length > 1 && (
              <div className="card divide-y divide-slate-100 !p-0">
                {upcoming.slice(1).map((e) => {
                  const dt = parseDate(e.date);
                  const meta = eventMeta(e);
                  return (
                    <Link key={e.id} href="/schedule" className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                      <div className="w-11 shrink-0 text-center leading-none">
                        <p className="text-sm font-bold text-slate-700">{dt.getMonth() + 1}.{dt.getDate()}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{WEEKDAYS_KO[dt.getDay()]}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{e.title}</p>
                        <p className="truncate text-xs text-slate-400">{meta || "시간·장소 미정"}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{ddayLabel(e.date)}</span>
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
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">바로가기</h2>
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map(({ href, title, desc, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)]"
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
                        {BOARD_LABEL[p.board]}
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
            <Link href="/admin" className="btn-accent">관리자 페이지</Link>
            <Link href="/members" className="btn-ghost">단원 명단</Link>
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
