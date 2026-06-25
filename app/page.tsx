"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import type { ScheduleEvent } from "@/lib/types";
import { toDateStr } from "@/lib/utils";

const FEATURES = [
  { href: "/schedule", emoji: "📅", title: "일정" },
  { href: "/archive", emoji: "🎬", title: "아카이빙" },
  { href: "/audio", emoji: "🎵", title: "음원 자료실" },
];

function HomeInner() {
  const { profile, role } = useAuth();
  const { settings } = useTheme();
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);

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
  }, []);

  return (
    <div className="space-y-5">
      {/* 인사 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          안녕하세요, <b className="text-slate-700">{profile?.name || profile?.displayName}</b>님 👋
        </p>
        {settings.currentProduction && (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            현재 공연 · {settings.currentProduction}
          </span>
        )}
      </div>

      {/* 다가오는 확정 일정 (최상단) */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">다가오는 일정</h2>
          <Link href="/schedule" className="text-sm font-medium text-accent">
            전체 보기 →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <span className="text-xs font-bold leading-none">{e.date.slice(5).replace("-", "/")}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.title}</p>
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

      {/* 기능 바로가기 — 앱 아이콘 3분할 */}
      <div className="grid grid-cols-3 gap-3">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-5 text-center shadow-sm transition hover:shadow-md hover:ring-1 hover:ring-accent/30"
          >
            <span className="text-3xl">{f.emoji}</span>
            <span className="text-xs font-semibold text-slate-700 sm:text-sm">{f.title}</span>
          </Link>
        ))}
      </div>

      {role === "admin" && (
        <div className="flex flex-wrap gap-3">
          <Link href="/admin" className="btn-accent">관리자 페이지</Link>
          <Link href="/members" className="btn-ghost">단원 명단</Link>
        </div>
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
