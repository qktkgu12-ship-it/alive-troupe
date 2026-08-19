"use client";

// 홈 상단 — 다가오는 확정 일정을 컬러 카드 캐러셀로 보여준다.
//
// 색은 일정 성격을 그대로 나타낸다:
//   전체 일정 = 빨강 / A팀 = 민트 / B팀 = 보라 / 네이버 예약 = 초록
// 카드 아래 점은 지금 보고 있는 카드의 색으로 물들면서 알약으로 늘어난다.
// 카드가 미끄러지는 것과 같은 곡선·시간을 써서 둘이 한 몸처럼 움직인다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClockIcon, PinIcon } from "@/components/Icons";
import { WEEKDAYS_KO } from "@/lib/utils";
import type { ScheduleEvent } from "@/lib/types";

// 카드가 미끄러지는 느낌 — 점 애니메이션도 이 값을 그대로 쓴다
const SLIDE = "420ms cubic-bezier(0.34, 1.36, 0.4, 1)";

// 팀 색은 일정 달력(TEAM_PALETTE)과 같은 색조·채도를 쓴다.
// 달력의 민트 rgb(94,234,212)는 파스텔이라 흰 글자를 얹으면 읽히지 않으므로
// 색조(170.6°)와 채도(77%)는 그대로 두고 명도만 64% → 42%로 낮췄다.
const COLORS = {
  all: "rgb(var(--accent))", // 전체 일정 — 극단 브랜드 색(accent)
  teamA: "#19BDA4", // 첫 번째 팀 — 달력 민트를 어둡게
  teamB: "#7A2FF2", // 두 번째 팀
  naver: "#2F9E44", // 네이버 예약
} as const;

/** 일정 하나가 어떤 색을 쓸지 */
export function eventColor(e: ScheduleEvent, teams: string[]): string {
  if (e.source === "naver") return COLORS.naver;
  if (!e.team) return COLORS.all;
  const i = teams.indexOf(e.team);
  if (i === 0) return COLORS.teamA;
  if (i === 1) return COLORS.teamB;
  return COLORS.all;
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

export default function ScheduleCarousel({
  events,
  teams,
}: {
  events: ScheduleEvent[];
  teams: string[];
}) {
  const router = useRouter();
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

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

  if (events.length === 0) {
    return (
      <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>
    );
  }

  const dotColor = eventColor(events[Math.min(idx, events.length - 1)], teams);

  return (
    <div>
      {/* 카드 줄 — 손으로 밀면 한 장씩 딱딱 맞춰 선다 */}
      <div
        ref={trackRef}
        // -mx-4 + px-4 : 화면 끝까지 흐르되 첫 카드는 아래 카드들과 같은 16px 안쪽에서 시작.
        // scroll-px-4 : 멈추는 자리도 좌우 16px씩 들여서 잡는다.
        //   양쪽을 같게 둬야 가운데 정렬 카드의 좌우 여백이 정확히 반씩 나뉜다.
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto scroll-smooth px-4"
      >
        {events.map((e, i) => {
          const color = eventColor(e, teams);
          const dt = parseDate(e.date);
          const href = `/schedule?tab=events&event=${e.id}&date=${e.date}`;
          // 첫 카드는 아래 카드들과 줄을 맞춰 왼쪽에, 마지막 카드는 오른쪽에 화살표
          // 자리를 남겨야 하므로 역시 왼쪽에. 사이 카드들만 가운데로 세운다.
          const edge = i === 0 || i === events.length - 1;
          return (
            <div
              key={e.id}
              role="link"
              tabIndex={0}
              onClick={() => router.push(href)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") router.push(href);
              }}
              style={{ backgroundColor: color }}
              className={`relative flex aspect-[3/2] w-[78%] max-w-[330px] shrink-0 cursor-pointer flex-col rounded-3xl p-4 text-white transition active:scale-[0.985] ${
                edge ? "snap-start" : "snap-center"
              }`}
            >
              {/* D-day */}
              <span className="inline-flex w-fit rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold backdrop-blur-sm">
                {ddayLabel(e.date)}
              </span>

              <p className="mt-2.5 text-[12px] font-medium text-white/75">
                {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
              </p>
              <h3 className="mt-0.5 line-clamp-2 text-[19px] font-extrabold leading-tight tracking-tight">
                {e.title}
              </h3>

              {/* 시간·장소 — 카드가 낮아진 만큼 한 줄로 붙인다 */}
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-2 text-[12px] font-medium text-white/85">
                {e.startTime && (
                  <span className="flex items-center gap-1">
                    <ClockIcon className="h-3.5 w-3.5 shrink-0 text-white/70" />
                    {e.startTime}
                    {e.endTime ? `~${e.endTime}` : ""}
                  </span>
                )}
                {e.location && (
                  <span className="flex min-w-0 items-center gap-1">
                    <PinIcon className="h-3.5 w-3.5 shrink-0 text-white/70" />
                    <span className="truncate">{e.location}</span>
                  </span>
                )}
                {!e.startTime && !e.location && (
                  <span className="text-white/60">시간·장소 미정</span>
                )}
              </div>
            </div>
          );
        })}

        {/* 마지막 카드 오른쪽 여백 — 전체 일정으로 가는 화살표 */}
        <div className="flex w-[22%] min-w-[72px] shrink-0 items-center justify-center">
          <Link
            href="/schedule"
            aria-label="전체 일정 보기"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-400 shadow-[0_4px_16px_-6px_rgba(16,24,40,0.28)] transition hover:text-accent active:scale-95"
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
                width: on ? 20 : 6,
                backgroundColor: on ? dotColor : "rgb(203 213 225)",
                transition: `width ${SLIDE}, background-color 260ms ease`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
