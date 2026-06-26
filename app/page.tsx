"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import { ArchiveIcon, CalendarIcon, MusicIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import { BOARD_LABEL, type Post, type ScheduleEvent } from "@/lib/types";
import { toDateStr } from "@/lib/utils";

const FEATURES = [
  { href: "/schedule", title: "일정", desc: "가능일정 · 확정일정", Icon: CalendarIcon },
  { href: "/archive", title: "아카이빙", desc: "공연 · 연습 기록", Icon: ArchiveIcon },
  { href: "/audio", title: "음원 자료실", desc: "MR · 가이드", Icon: MusicIcon },
];

function HomeInner() {
  const { profile, role } = useAuth();
  const { settings } = useTheme();
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
          .slice(0, 5);
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            안녕하세요, {profile?.name || profile?.displayName}님
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">오늘의 일정과 자료를 확인해 보세요.</p>
        </div>
        {settings.currentProduction && (
          <span className="rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
            현재 공연 · {settings.currentProduction}
          </span>
        )}
      </header>

      {/* 다가오는 확정 일정 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">다가오는 일정</h2>
          <Link href="/schedule" className="text-sm font-medium text-accent hover:underline">
            전체 보기 →
          </Link>
        </div>
        <div className="card !p-2">
          {upcoming.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3.5 px-3 py-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft leading-none text-accent">
                    <span className="text-[10px] font-semibold">{Number(e.date.slice(5, 7))}월</span>
                    <span className="text-lg font-extrabold">{Number(e.date.slice(8, 10))}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{e.title}</p>
                    <p className="truncate text-sm text-slate-500">
                      {[e.startTime && `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}`, e.location]
                        .filter(Boolean)
                        .join(" · ") || "시간·장소 미정"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 바로가기 */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">바로가기</h2>
        <div className="grid grid-cols-3 gap-3">
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
                  <Link href={`/board/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                    {p.isNotice ? (
                      <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">공지</span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {BOARD_LABEL[p.board]}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.title}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                      <Avatar src={p.authorAvatar} name={p.authorName} className="h-6 w-6 text-[10px]" />
                      <span className="hidden sm:inline">{p.authorName}</span>
                    </span>
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
