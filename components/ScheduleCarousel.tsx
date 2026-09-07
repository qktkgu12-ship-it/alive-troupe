"use client";

// 홈 상단 — 다가오는 확정 일정을 '펼쳐지는' 카드 캐러셀로 보여준다.
// 카드 한 장의 생김새·동작은 일정 페이지 목록과 공용이다 (components/EventCard).
// 여기선 가로 스크롤·스냅과, 펼쳤을 때 카드가 화면을 꽉 채우는 것만 맡는다.
// dot 인디케이터는 제거됨 — peek(옆 카드 삐침)이 슬라이드 가능성을 충분히 전달한다.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getMembers } from "@/lib/members";
import EventCard, { EXPAND, eventColor, type Member } from "@/components/EventCard";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/Icons";
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
  // 늦참 — attendees 문서에 late 플래그로 같이 들어 있어 조회가 늘지 않는다
  const [lateBy, setLateBy] = useState<Record<string, { uid: string; reason: string }[]>>({});

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
        const lateList =
          att?.docs
            .filter((d) => (d.data() as { late?: boolean }).late)
            .map((d) => ({ uid: d.id, reason: (d.data().lateReason as string) ?? "" })) ?? [];
        return [e.id, absList, att?.docs.map((d) => d.id) ?? [], lateList] as const;
      })
    );
    setAbsentBy(Object.fromEntries(rows.map(([id, a]) => [id, a])));
    setExtraBy(Object.fromEntries(rows.map(([id, , x]) => [id, x])));
    setLateBy(Object.fromEntries(rows.map(([id, , , l]) => [id, l])));
  }, [events]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // 어느 카드를 방금 펼쳤는지 (아래 자리 잡기에서 쓴다)
  const openIdx = useRef(-1);

  /**
   * PC 좌우 버튼.
   *
   * 폰은 손으로 밀면 되지만 마우스에는 가로 스크롤 막대가 숨겨져 있어(no-scrollbar)
   * 밀 수단이 마땅찮다. 그래서 PC에서만 버튼을 띄운다.
   * (휠로 넘기는 것도 함께 되지만, 휠은 커서를 이 줄에 올려 둬야만 먹는다 —
   *  버튼은 그것 없이도 눈에 보이는 수단이라 둘 다 둔다.)
   * 끝에 닿은 쪽 버튼은 아예 안 그린다(누를 수 없는 버튼을 두지 않는다).
   */
  const [nav, setNav] = useState({ left: false, right: false });
  const updateNav = useCallback(() => {
    const t = trackRef.current;
    if (!t) return;
    const max = t.scrollWidth - t.clientWidth;
    // 4px은 소수점 오차용 — 끝에 닿았는데 버튼이 남아 있지 않게
    setNav({ left: t.scrollLeft > 4, right: t.scrollLeft < max - 4 });
  }, []);
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    updateNav();
    t.addEventListener("scroll", updateNav, { passive: true });
    const ro = new ResizeObserver(updateNav);
    ro.observe(t);
    return () => {
      t.removeEventListener("scroll", updateNav);
      ro.disconnect();
    };
  }, [updateNav, events.length]);

  /** 카드 한 장 + 사이 간격만큼 옮긴다 — 스냅이 나머지를 맞춰 준다 */
  const nudge = useCallback((dir: -1 | 1) => {
    const t = trackRef.current;
    const kid = t?.firstElementChild as HTMLElement | undefined;
    if (!t || !kid) return;
    t.scrollBy({ left: dir * (kid.getBoundingClientRect().width + 12), behavior: "smooth" });
  }, []);

  /**
   * 휠로 옆으로 넘기기 (마우스가 있는 기기에서만 — 폰은 휠 자체가 없다).
   *
   * ⚠️ 원래 권하지 않는 방식이다. 페이지를 세로로 내리다 커서가 이 줄 위를
   *    지나가는 순간 페이지가 멈추고 카드가 옆으로 흐른다. 그래도 쓰기로 했으니
   *    부작용이 최소가 되게 네 가지를 지킨다 —
   *
   *   ① **끝에 닿으면 놓아 준다.** 그 방향으로 더 갈 데가 없으면 가로채지 않는다.
   *      → 카드를 끝까지 넘긴 뒤에는 페이지가 자연스럽게 이어서 내려간다.
   *      이게 없으면 이 줄 위에서 페이지가 영영 안 내려간다.
   *   ② **트랙패드의 가로 스크롤(deltaX)은 건드리지 않는다.** 원래 잘 되던 것이다.
   *   ③ **한 번 굴리면 한 장.** 트랙패드는 작은 이벤트를 우수수 보내서,
   *      그대로 더하면 한 번 쓸어내릴 때 카드가 다 지나가 버린다.
   *   ④ 삼킨 이벤트는 기본 동작도 같이 막는다 — 안 막으면 페이지가 덜컥거린다.
   *
   * 펼친 동안에는 넘길 일이 없으므로 아예 안 듣는다.
   * ⚠️ passive:false로 직접 붙인다. 리액트의 onWheel로는 preventDefault가 안 먹는다.
   */
  const wheelAt = useRef(0);
  useEffect(() => {
    const t = trackRef.current;
    if (!t || openId) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // ②
      if (Math.abs(e.deltaY) < 12) return;                 // 미세한 떨림은 무시
      const max = t.scrollWidth - t.clientWidth;
      if (max <= 0) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      if (dir > 0 && t.scrollLeft >= max - 4) return;       // ① 오른쪽 끝
      if (dir < 0 && t.scrollLeft <= 4) return;             // ① 왼쪽 끝
      e.preventDefault();                                   // ④
      if (e.timeStamp - wheelAt.current < 260) return;      // ③
      wheelAt.current = e.timeStamp;
      nudge(dir);
    };
    t.addEventListener("wheel", onWheel, { passive: false });
    return () => t.removeEventListener("wheel", onWheel);
  }, [openId, nudge]);

  function toggle(i: number, id: string) {
    const next = openId === id ? null : id;
    openIdx.current = next ? i : -1;
    setOpenId(next);
  }

  // 펼친 카드를 제자리에 붙들어 둔다.
  //
  // [버그] 가운데 있던 카드를 펼치면 오른쪽으로 밀려나 있었다. 원인이 둘이었다.
  //   1) scrollIntoView({ inline: "center" })는 '지금 이 순간의 카드 폭'으로 가운데를
  //      계산한다. 그런데 호출 시점엔 카드가 아직 작은 상태라, 다 커지고 나면
  //      그 자리가 더는 가운데가 아니었다.
  //   2) 거기에 스크롤 스냅이 끼어들었다. 카드가 커지면 스냅 지점도 같이 움직여서
  //      브라우저가 카드를 한 번 더 끌고 갔다.
  //
  // 고친 방법:
  //   1) 카드의 왼쪽 끝을 기준으로 삼는다. 카드가 아무리 넓어져도 제 왼쪽 끝은
  //      그대로라 계산이 흔들리지 않는다. 펼친 카드는 화면 폭을 꽉 채우므로
  //      왼쪽 여백 16px에 맞추면 그게 곧 가운데다.
  //      ⚠️ offsetLeft를 쓰면 안 된다. 그 값은 '가장 가까운 positioned 조상'에서
  //         재는 값이라, 트랙 바깥 어딘가에 position:relative가 하나 붙기만 해도
  //         기준점이 통째로 옮겨간다. 실제로 화살표 버튼을 놓으려고 감싸는 div에
  //         relative를 붙였더니 펼친 카드가 딱 16px(트랙의 -mx-4만큼) 오른쪽으로
  //         쏠렸다. 그래서 화면 좌표로 직접 잰다 — 무엇이 어디에 붙든 안 흔들린다.
  //   2) 펼쳐진 동안에는 스냅을 끈다 (아래 트랙 className).
  //   3) 커지는 360ms 동안 매 프레임 같은 자리로 되잡는다 — 다른 카드를 펼쳐
  //      앞 카드가 줄어드는 경우에는 왼쪽 끝도 같이 움직이기 때문이다.
  //      (smooth로 한 번 굴리면 커지는 애니메이션과 서로 밀어내서 더 흔들린다)
  //
  // 접을 때는 아무것도 안 한다 — 스냅이 다시 켜지면서 브라우저가 알아서 가운데로 되돌린다.
  useLayoutEffect(() => {
    if (!openId) return;
    const track = trackRef.current;
    const kid = track?.children[openIdx.current] as HTMLElement | undefined;
    if (!track || !kid) return;
    const t0 = performance.now();
    let raf = 0;
    const pin = () => {
      // 지금 스크롤 위치 + (카드가 트랙 왼쪽 끝에서 떨어진 거리) = 트랙 안에서의 자리
      const inTrack =
        track.scrollLeft + (kid.getBoundingClientRect().left - track.getBoundingClientRect().left);
      track.scrollTo({
        left: Math.max(0, inTrack - 16),
        behavior: "instant" as ScrollBehavior,
      });
      if (performance.now() - t0 < 420) raf = requestAnimationFrame(pin);
    };
    pin();
    return () => cancelAnimationFrame(raf);
  }, [openId]);

  if (events.length === 0) {
    return (
      <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>
    );
  }

  return (
    <div className="relative">
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
        //
        // 펼친 동안에는 snap을 끈다. 카드가 넓어지는 중에 스냅이 다시 계산되면
        // 브라우저가 '가장 가까운 스냅 지점'으로 카드를 끌고 가 자리가 튄다.
        className={`no-scrollbar -mx-4 -mb-4 flex scroll-px-4 items-start gap-3 overflow-x-auto scroll-smooth px-4 pb-4 ${
          openId ? "" : "snap-x snap-mandatory"
        }`}
      >
        {/* 일정이 하나뿐이면 밀 데가 없다.
            그때도 78%로 두면 오른쪽에 '다음 카드가 있는 척'하는 빈자리가 남는데,
            peek은 밀 수 있다는 신호이므로 밀 게 없을 때 남겨 두면 거짓 신호가 된다.
            한 장일 때만 아래 아카이브·자료실 카드와 폭을 맞춘다. */}
        {events.map((e, i) => {
          const only = events.length === 1;
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
              lateBy={lateBy[e.id] ?? []}
              myUid={user?.uid ?? ""}
              myName={profile?.name || profile?.displayName || ""}
              onChanged={loadAttendance}
              onOpenDetail={() => router.push(`/schedule?tab=events&event=${e.id}&date=${e.date}`)}
              wrapperClassName={`shrink-0 ${edge ? "snap-start" : "snap-center"}`}
              wrapperStyle={{
                // 옆 카드가 살짝 보이는 peek — 밀 수 있는 줄이라는 걸 알려 주는 장치라 유지한다.
                // 펼치면 화면 폭(좌우 16px 여백 제외)을 꽉 채워 옆 카드를 가린다.
                width: open || only ? "calc(100vw - 32px)" : "78%",
                maxWidth: open || only ? 520 : 330,
                // 위에서부터 상단 16 + 배지줄 19 + 10 + 제목 두 줄 50 = 95.
                // 바닥 줄(시간·아바타)은 아바타 24 + 바닥 여백 14 = 38.
                // 95 + 38 = 133이 최소치라, 제목과 바닥 줄이 붙지 않게
                // 숨 쉴 틈을 더해 160으로 잡았다. (제목을 더 키우면 이 값도 같이 올려야 한다)
                ...(open ? {} : { height: 160 }),
                transition: `width ${EXPAND}, max-width ${EXPAND}`,
              }}
            />
          );
        })}
      </div>

      {/* 좌우 버튼 — PC에서만(md 이상). 폰은 손으로 밀면 되므로 안 그린다.
          넷플릭스 방식: 평소엔 안 보이다가 **끝 가장자리에 마우스를 가져가면**
          카드 높이만큼의 띠가 스르륵 떠오른다.
            · 버튼 자신이 곧 '가져다 대는 자리'다 — opacity:0이어도 마우스는 닿으므로
              hover:opacity-100 하나로 '끝에 가져가면 나타난다'가 그대로 된다.
              (다 나타난 뒤에야 누르게 되므로 '안 보이는 걸 눌렀다'가 생기지 않는다)
            · 판 색은 **앱 배경색**(bg-canvas)을 65%로 깐 것 + 블러 2px.
              흰색으로 깔면 카드(흰색)와 같은 색이라 띠의 경계가 사라진다.
              배경색이면 '카드 밖의 것이 카드 위로 올라온' 것으로 읽히고,
              블러 덕에 아래 카드가 비쳐 떠 있는 느낌은 그대로다.
              어두운 판(넷플릭스)은 이 앱이 밝은 테마라 구멍처럼 보인다.
            · 꺾쇠는 0.9배에서 제 크기로 — 페이드만이면 '켜졌다'에 가깝고,
              살짝 커지면 '떠올랐다'로 읽힌다.
          h-40(160px) = 접힌 카드 높이. 바깥쪽 모서리만 카드와 같은 라운드로 깎는다.
          카드를 펼친 동안에는 한 장이 화면을 꽉 채우므로 밀 일이 없다 → 숨긴다. */}
      {!openId && nav.left && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="이전 일정"
          className="group absolute left-0 top-0 z-10 hidden h-40 w-12 place-items-center rounded-l-2xl bg-canvas/65 text-slate-800 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 md:grid"
        >
          <ChevronLeftIcon className="h-8 w-8 scale-90 transition-transform duration-200 group-hover:scale-100" />
        </button>
      )}
      {!openId && nav.right && (
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="다음 일정"
          className="group absolute right-0 top-0 z-10 hidden h-40 w-12 place-items-center rounded-r-2xl bg-canvas/65 text-slate-800 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 md:grid"
        >
          <ChevronRightIcon className="h-8 w-8 scale-90 transition-transform duration-200 group-hover:scale-100" />
        </button>
      )}

      {/* dot 인디케이터 제거 — 카드가 옆으로 삐져나오는(peek) 것만으로
          슬라이드가 있다는 걸 충분히 전달한다. dot이 없으면
          캐러셀↔아카이브 사이가 깔끔하게 비워져 시각적 위계도 좋아진다. */}
    </div>
  );
}
