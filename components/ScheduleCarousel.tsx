"use client";

// 홈 상단 — 다가오는 확정 일정을 '펼쳐지는' 카드 캐러셀로 보여준다.
// 카드 한 장의 생김새·동작은 일정 페이지 목록과 공용이다 (components/EventCard).
// 여기선 가로 스크롤·스냅·점 표시와, 펼쳤을 때 카드가 화면을 꽉 채우는 것만 맡는다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import EventCard, { EXPAND, eventColor, type Member } from "@/components/EventCard";
import type { ScheduleEvent } from "@/lib/types";

export { eventColor };

// 카드가 미끄러지는 느낌 — 점 애니메이션도 이 값을 그대로 쓴다
const SLIDE = "420ms cubic-bezier(0.34, 1.36, 0.4, 1)";

export default function ScheduleCarousel({
  events,
  teams,
}: {
  events: ScheduleEvent[];
  teams: string[];
}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // 전 단원 명단 (아바타·팀) — 참여인원 계산에 쓴다
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    getDocs(collection(db, "publicProfiles"))
      .then((snap) =>
        setMembers(
          snap.docs.map((d) => {
            const p = d.data() as { name?: string; avatar?: string; team?: string };
            return { uid: d.id, name: p.name ?? "", avatar: p.avatar, team: p.team };
          })
        )
      )
      .catch(() => setMembers([]));
  }, []);

  // 일정별 불참(absences, 사유 포함) · 추가참석(attendees) 목록
  const [absentBy, setAbsentBy] = useState<Record<string, { uid: string; reason: string }[]>>({});
  const [extraBy, setExtraBy] = useState<Record<string, string[]>>({});

  const loadAttendance = useCallback(async () => {
    if (events.length === 0) return;
    const rows = await Promise.all(
      events.map(async (e) => {
        const [abs, att] = await Promise.all([
          getDocs(collection(db, "events", e.id, "absences")).catch(() => null),
          getDocs(collection(db, "events", e.id, "attendees")).catch(() => null),
        ]);
        const absList =
          abs?.docs.map((d) => ({ uid: d.id, reason: (d.data().reason as string) ?? "" })) ?? [];
        return [e.id, absList, att?.docs.map((d) => d.id) ?? []] as const;
      })
    );
    setAbsentBy(Object.fromEntries(rows.map(([id, a]) => [id, a])));
    setExtraBy(Object.fromEntries(rows.map(([id, , x]) => [id, x])));
  }, [events]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // 스크롤이 멈춘 자리에서 가장 가까운 카드를 '보고 있는 카드'로 친다.
  // (줄 끝의 화살표 칸은 카드가 아니므로 셈에서 뺀다)
  const count = events.length;
  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const kids = Array.from(el.children).slice(0, count) as HTMLElement[];
    if (kids.length === 0) return;
    // 카드마다 서는 자리가 다르므로(왼쪽 / 가운데) 왼쪽 끝이 아니라
    // '카드 한가운데가 화면 한가운데에 가장 가까운 것'으로 고른다.
    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    let best = 0;
    let min = Infinity;
    kids.forEach((k, i) => {
      const kr = k.getBoundingClientRect();
      const d = Math.abs(kr.left + kr.width / 2 - mid);
      if (d < min) {
        min = d;
        best = i;
      }
    });
    setIdx(best);
  }, [count]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [sync]);

  // 펼칠 때 그 카드를 화면 안으로 데려온다 (옆 카드가 안 보이므로 자리를 맞춰 준다)
  function toggle(i: number, id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (!next) return;
    requestAnimationFrame(() => {
      const kid = trackRef.current?.children[i] as HTMLElement | undefined;
      kid?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    });
  }

  if (events.length === 0) {
    return (
      <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>
    );
  }

  return (
    <div>
      {/* 카드 줄 — 손으로 밀면 한 장씩 딱딱 맞춰 선다 */}
      <div
        ref={trackRef}
        // -mx-4 + px-4 : 화면 끝까지 흐르되 첫 카드는 아래 카드들과 같은 16px 안쪽에서 시작.
        // scroll-px-4 : 멈추는 자리도 좌우 16px씩 들여서 잡는다.
        //   양쪽을 같게 둬야 가운데 정렬 카드의 좌우 여백이 정확히 반씩 나뉜다.
        // items-start : 펼친 카드만 길어지고 나머지는 원래 높이를 지킨다.
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto scroll-smooth px-4"
      >
        {events.map((e, i) => {
          const edge = i === 0 || i === events.length - 1;
          const open = openId === e.id;
          return (
            <EventCard
              key={e.id}
              e={e}
              color={eventColor(e, teams)}
              open={open}
              onToggle={() => toggle(i, e.id)}
              members={members}
              absences={absentBy[e.id] ?? []}
              extraUids={extraBy[e.id] ?? []}
              myUid={user?.uid ?? ""}
              myName={profile?.name || profile?.displayName || ""}
              onChanged={loadAttendance}
              onOpenDetail={() => router.push(`/schedule?tab=events&event=${e.id}&date=${e.date}`)}
              wrapperClassName={`shrink-0 ${edge ? "snap-start" : "snap-center"}`}
              wrapperStyle={{
                // 펼치면 화면 폭(좌우 16px 여백 제외)을 꽉 채워 옆 카드를 가린다
                width: open ? "calc(100vw - 32px)" : "78%",
                maxWidth: open ? 520 : 330,
                // 접힘: 가로 폭과 무관하게 높이를 160px로 고정한다.
                // (비율로 잡으면 화면이 넓을수록 카드가 같이 높아져 커 보인다)
                // 펼치면 내용만큼 늘어나야 하므로 높이를 풀어 준다.
                ...(open ? {} : { height: 160 }),
                transition: `width ${EXPAND}, max-width ${EXPAND}`,
              }}
            />
          );
        })}

        {/* 마지막 카드 오른쪽 여백 — 전체 일정으로 가는 화살표 */}
        <div className="flex w-[22%] min-w-[72px] shrink-0 items-center justify-center self-stretch">
          <Link
            href="/schedule"
            aria-label="전체 일정 보기"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-400 shadow-[0_2px_10px_-6px_rgba(16,24,40,0.18)] transition hover:text-accent active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* 점 — 보고 있는 카드 자리에서 그 색 알약으로 늘어난다 */}
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {events.map((e, i) => {
          const on = i === idx;
          return (
            <button
              key={e.id}
              type="button"
              aria-label={`${i + 1}번째 일정 보기`}
              aria-current={on ? "true" : undefined}
              onClick={() => {
                // 그 카드가 원래 서는 자리(왼쪽 / 가운데)로 보낸다.
                // scroll-padding은 브라우저가 알아서 지켜 준다.
                const kid = trackRef.current?.children[i] as HTMLElement | undefined;
                const inline = i === 0 || i === events.length - 1 ? "start" : "center";
                kid?.scrollIntoView({ inline, block: "nearest", behavior: "smooth" });
              }}
              className="h-1.5 rounded-full"
              style={{
                width: on ? 14 : 6,
                // 일정별 강조색을 쓰면 로고(빨강)와 부딪히고, 색이 무슨 뜻인지도 알 수 없다.
                // 위치만 알려주면 되는 요소라 무채색으로 둔다.
                backgroundColor: on ? "rgb(100 116 139)" : "rgb(203 213 225)",
                transition: `width ${SLIDE}, background-color 260ms ease`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
