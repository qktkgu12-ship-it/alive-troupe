"use client";

// 홈 상단 — 다가오는 확정 일정을 '펼쳐지는' 카드 캐러셀로 보여준다.
// 카드 한 장의 생김새·동작은 일정 페이지 목록과 공용이다 (components/EventCard).
// 여기선 가로 스크롤·스냅과, 펼쳤을 때 카드가 화면을 꽉 채우는 것만 맡는다.
// dot 인디케이터는 제거됨 — peek(옆 카드 삐침)이 슬라이드 가능성을 충분히 전달한다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getMembers } from "@/lib/members";
import EventCard, { EXPAND, eventColor, type Member } from "@/components/EventCard";
import type { ScheduleEvent } from "@/lib/types";

export { eventColor };

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
  const [openId, setOpenId] = useState<string | null>(null);

  // 전 단원 명단 (아바타·팀) — 참여인원 계산에 쓴다
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    getMembers()
      .then((list) =>
        setMembers(list.map((m) => ({ uid: m.uid, name: m.name ?? "", avatar: m.avatar, team: m.team })))
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
      {/* 섹션 제목 — 아카이브·자료실과 같은 '제목 >' 문법.
          제일 중요한 일정만 제목이 없어 이름 없는 덩어리로 보이던 걸 맞췄다.
          카드 밖에 두므로 아래 카드들과 왼쪽 끝이 정확히 맞는다. */}
      <Link
        href="/schedule"
        aria-label="전체 일정 보기"
        className="mb-2.5 flex items-center justify-between"
      >
        <h2 className="text-[22px] font-bold tracking-tight text-slate-900">다가오는 일정</h2>
        <span className="grid h-7 w-7 place-items-center rounded-full text-slate-300 transition hover:text-accent">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </span>
      </Link>

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
                // 옆 카드가 살짝 보이는 peek — 밀 수 있는 줄이라는 걸 알려 주는 장치라 유지한다.
                // 펼치면 화면 폭(좌우 16px 여백 제외)을 꽉 채워 옆 카드를 가린다.
                width: open ? "calc(100vw - 32px)" : "78%",
                maxWidth: open ? 520 : 330,
                // 상단 14 + 제목칸 44 + 날짜줄 22 = 80, 아바타 24 + 바닥 12 = 36.
                // 116이 최소치라 숨 쉴 틈을 더해 128로 잡았다.
                ...(open ? {} : { height: 128 }),
                transition: `width ${EXPAND}, max-width ${EXPAND}`,
              }}
            />
          );
        })}
      </div>

      {/* dot 인디케이터 제거 — 카드가 옆으로 삐져나오는(peek) 것만으로
          슬라이드가 있다는 걸 충분히 전달한다. dot이 없으면
          캐러셀↔아카이브 사이가 깔끔하게 비워져 시각적 위계도 좋아진다. */}
    </div>
  );
}
