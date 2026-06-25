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
  { href: "/schedule", emoji: "📅", title: "일정", desc: "가능 일자 체크 · 확정 일정 확인" },
  { href: "/archive", emoji: "🎬", title: "아카이빙", desc: "공연·연습 사진/영상 기록" },
  { href: "/audio", emoji: "🎵", title: "음원 자료실", desc: "MR · 가이드 음원 다운로드" },
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
    <div className="space-y-6">
      {/* 환영 배너 */}
      <div className="overflow-hidden rounded-2xl bg-accent p-6 text-accent-fg shadow-sm">
        <p className="text-sm opacity-80">안녕하세요, {profile?.name || profile?.displayName}님 👋</p>
        <h1 className="mt-1 text-2xl font-bold">{settings.troupeName}</h1>
        {settings.currentProduction ? (
          <p className="mt-2 inline-block rounded-full bg-black/15 px-3 py-1 text-sm font-medium">
            현재 공연 · {settings.currentProduction}
          </p>
        ) : (
          <p className="mt-2 text-sm opacity-80">함께 만들어가는 무대 ✨</p>
        )}
      </div>

      {/* 기능 바로가기 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <Link key={f.href} href={f.href} className="card transition hover:shadow-md hover:ring-1 hover:ring-accent/30">
            <div className="text-3xl">{f.emoji}</div>
            <div className="mt-3 font-bold">{f.title}</div>
            <div className="mt-1 text-sm text-slate-500">{f.desc}</div>
          </Link>
        ))}
      </div>

      {/* 다가오는 확정 일정 */}
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
