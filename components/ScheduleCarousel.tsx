"use client";

// 홈 상단 — 다가오는 확정 일정을 '펼쳐지는' 카드 캐러셀로 보여준다.
// 카드 한 장의 생김새·동작은 일정 페이지 목록과 공용이다 (components/EventCard).
// 여기선 가로 스크롤·스냅과, 펼쳤을 때 카드가 화면을 꽉 채우는 것만 맡는다.
// dot 인디케이터는 제거됨 — peek(옆 카드 삐침)이 슬라이드 가능성을 충분히 전달한다.

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
      {/* 섹션 제목은 여기 없다 — 홈의 인사말 블록 둘째 줄이 그 역할을 겸한다.
          큰 제목(인사말 26px)과 섹션 제목(22px)이 나란히 있으면 서로 경쟁해
          어느 쪽이 주인공인지 안 읽혔다. 제목을 하나로 합쳐 그 경쟁을 없앴다. */}

      {/* 카드 줄 — 손으로 밀면 한 장씩 딱딱 맞춰 선다 */}
      <div
        ref={trackRef}
        // -mx-4 + px-4 : 화면 끝까지 흐르되 첫 카드는 아래 카드들과 같은 16px 안쪽에서 시작.
        // scroll-px-4 : 멈추는 자리도 좌우 16px씩 들여서 잡는다.
        //   양쪽을 같게 둬야 가운데 정렬 카드의 좌우 여백이 정확히 반씩 나뉜다.
        // items-start : 펼친 카드만 길어지고 나머지는 원래 높이를 지킨다.
        //
        // -mb-4 + pb-4 : 카드 그림자가 잘리지 않게 하는 장치.
        //   overflow-x를 auto로 두면 CSS 규칙상 세로축도 함께 잘림 처리가 되어
        //   카드 아래로 12px 뻗는 그림자가 트랙 끝에서 싹둑 잘린다.
        //   안쪽에 16px 자리를 만들고 같은 만큼 마진으로 당겨 위치는 그대로 둔다.
        className="no-scrollbar -mx-4 -mb-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto scroll-smooth px-4 pb-4"
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
                // 상단 16 + 배지줄 17 + 10 + 제목 46 + 8 + 시간줄 18 = 115,
                // 아바타 24 + 바닥 14 = 38. 115+38 = 153이 최소치라
                // 시간줄과 아바타가 붙지 않게 숨 쉴 틈을 더해 160으로 잡았다.
                ...(open ? {} : { height: 160 }),
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
