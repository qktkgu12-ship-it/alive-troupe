"use client";

// 홈 상단 — 다가오는 확정 일정을 '펼쳐지는' 카드 캐러셀로 보여준다.
//
// 흰 바탕 + 왼쪽 세로 색 바로 일정 성격을 구분한다:
//   전체 일정 = 빨강 / A팀 = 민트 / B팀 = 보라 / 네이버 예약 = 초록
//
// 접힘: 날짜·D-day / 제목 / 시작시간 / 참여인원 아바타
//   (장소는 펼쳤을 때만 — 대부분 '스튜디오 얼라이브'라 접힘에선 군더더기)
// 펼침: 카드가 화면 폭을 꽉 채워 옆 카드가 보이지 않는다. 접힘에서 보이던
//   시간·아바타 줄은 사라지고(펼친 내용과 중복) 상세 목록으로 대체된다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Avatar from "@/components/Avatar";
import BottomSheet from "@/components/BottomSheet";
import { ClockIcon, PinIcon } from "@/components/Icons";
import { ampmTimeKo, WEEKDAYS_KO } from "@/lib/utils";
import type { ScheduleEvent } from "@/lib/types";

// 카드가 미끄러지는 느낌 — 점 애니메이션도 이 값을 그대로 쓴다
const SLIDE = "420ms cubic-bezier(0.34, 1.36, 0.4, 1)";
// 펼침/접힘 — 높이가 늘어나는 건 조금 더 차분하게
const EXPAND = "360ms cubic-bezier(0.32, 0.72, 0.28, 1)";

// 팀 색은 일정 달력(TEAM_PALETTE)과 같은 색조·채도를 쓴다.
// 흰 바탕 위 세로 바·글자로만 쓰므로 어두운 쪽 값을 그대로 유지한다.
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

// 홈 카드에 쓰는 최소 프로필 (publicProfiles)
type Member = { uid: string; name: string; avatar?: string; team?: string };

/** 겹쳐 놓은 아바타 줄 — 뒤 아바타가 앞 아바타에 살짝 물린다 */
function AvatarStack({
  members,
  max = 4,
  size = "h-7 w-7",
}: {
  members: Member[];
  max?: number;
  size?: string;
}) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <div
          key={m.uid}
          className="rounded-full bg-white p-[2px]"
          style={{ marginLeft: i === 0 ? 0 : -9, zIndex: shown.length - i }}
        >
          <Avatar src={m.avatar} name={m.name} className={size} />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="grid place-items-center rounded-full bg-white p-[2px]"
          style={{ marginLeft: -9, zIndex: 0 }}
        >
          <span
            className={`grid ${size} place-items-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500`}
          >
            +{rest}
          </span>
        </div>
      )}
    </div>
  );
}

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

  const dotColor = eventColor(events[Math.min(idx, events.length - 1)], teams);

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
        {events.map((e, i) => (
          <EventCard
            key={e.id}
            e={e}
            color={eventColor(e, teams)}
            open={openId === e.id}
            onToggle={() => toggle(i, e.id)}
            edge={i === 0 || i === events.length - 1}
            members={members}
            absences={absentBy[e.id] ?? []}
            extraUids={extraBy[e.id] ?? []}
            myUid={user?.uid ?? ""}
            myName={profile?.name || profile?.displayName || ""}
            onChanged={loadAttendance}
            onOpenDetail={() => router.push(`/schedule?tab=events&event=${e.id}&date=${e.date}`)}
          />
        ))}

        {/* 마지막 카드 오른쪽 여백 — 전체 일정으로 가는 화살표 */}
        <div className="flex w-[22%] min-w-[72px] shrink-0 items-center justify-center self-stretch">
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

// ---------- 카드 한 장 ----------
function EventCard({
  e,
  color,
  open,
  onToggle,
  edge,
  members,
  absences,
  extraUids,
  myUid,
  myName,
  onChanged,
  onOpenDetail,
}: {
  e: ScheduleEvent;
  color: string;
  open: boolean;
  onToggle: () => void;
  edge: boolean;
  members: Member[];
  absences: { uid: string; reason: string }[];
  extraUids: string[];
  myUid: string;
  myName: string;
  onChanged: () => void;
  onOpenDetail: () => void;
}) {
  const dt = parseDate(e.date);
  const [busy, setBusy] = useState(false);
  const [reasonSheet, setReasonSheet] = useState(false);
  const [rosterSheet, setRosterSheet] = useState(false);
  const [reason, setReason] = useState("");

  // 기본 명단 우선순위:
  //   1) participantUids가 있으면 그 명단만 (개별 지정 예약)
  //   2) 없고 team이 있으면 그 팀 단원
  //   3) 둘 다 없으면 전 단원
  // 여기에 '나도 참여하기'(attendees)를 더하고 불참(absences)을 뺀 것이 실제 참석자다.
  const { going, iAmBase, iAmGoing } = useMemo(() => {
    const picked = e.participantUids ?? [];
    const base =
      picked.length > 0
        ? members.filter((m) => picked.includes(m.uid))
        : members.filter((m) => (e.team ? m.team === e.team : true));
    const baseUids = new Set(base.map((m) => m.uid));
    const extra = members.filter((m) => extraUids.includes(m.uid) && !baseUids.has(m.uid));
    const absent = new Set(absences.map((a) => a.uid));
    const list = [...base, ...extra].filter((m) => !absent.has(m.uid));
    return {
      going: list,
      iAmBase: baseUids.has(myUid),
      iAmGoing: list.some((m) => m.uid === myUid),
    };
  }, [members, extraUids, absences, e.team, e.participantUids, myUid]);

  // 불참자 — 명단에 없는 uid도 이름은 남아 있으므로 프로필이 없으면 건너뛴다
  const absentMembers = useMemo(
    () =>
      absences
        .map((a) => {
          const m = members.find((x) => x.uid === a.uid);
          return m ? { ...m, reason: a.reason } : null;
        })
        .filter((x): x is Member & { reason: string } => x !== null),
    [members, absences]
  );

  // 참석으로 전환 — 불참 기록을 지우고, 기본 명단 밖이면 attendees에 넣는다
  async function setAttend() {
    if (!myUid || busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "events", e.id, "absences", myUid)).catch(() => {});
      if (!iAmBase) {
        await setDoc(doc(db, "events", e.id, "attendees", myUid), {
          uid: myUid,
          name: myName,
          createdAt: Date.now(),
        });
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // 불참으로 전환 — 사유 시트를 먼저 띄운다 (사유는 선택)
  async function setAbsent() {
    if (!myUid || busy) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "events", e.id, "absences", myUid), {
        uid: myUid,
        name: myName,
        reason: reason.trim(),
        createdAt: Date.now(),
      });
      // 기본 명단 밖에서 참여했던 사람이면 추가참석 기록도 정리
      if (!iAmBase) await deleteDoc(doc(db, "events", e.id, "attendees", myUid)).catch(() => {});
      setReason("");
      setReasonSheet(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-3xl bg-white shadow-[0_4px_18px_-8px_rgba(16,24,40,0.22)] ${
        edge ? "snap-start" : "snap-center"
      }`}
      style={{
        // 펼치면 화면 폭(좌우 16px 여백 제외)을 꽉 채워 옆 카드를 가린다
        width: open ? "calc(100vw - 32px)" : "78%",
        maxWidth: open ? 520 : 330,
        transition: `width ${EXPAND}, max-width ${EXPAND}`,
      }}
    >
      <div className="flex">
        {/* 왼쪽 팀색 바 */}
        <div className="w-[5px] shrink-0 self-stretch" style={{ backgroundColor: color }} />

        <div className="min-w-0 flex-1">
          {/* ===== 머리 — 항상 보이는 부분 =====
               버튼을 relative + min-h로 만들고 chevron·하단바를 absolute로 고정.
               덕분에 아바타가 카드 오른쪽 끝에 딱 붙고, 제목이 길어도 높이가 늘어난다. */}
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="relative w-full px-4 pt-3.5 text-left"
            style={{
              // 접힘: 제목 영역(최소 72px) + 하단바 영역(56px)
              // 펼침: 제목 영역만 (하단바가 사라지므로 padding 축소)
              paddingBottom: open ? 12 : 56,
              minHeight: open ? 0 : 170,
            }}
          >
            {/* D-day + 날짜 */}
            <div className="flex items-center gap-1.5 pr-10">
              <span
                className="rounded-full px-2 py-[2px] text-[11px] font-extrabold"
                style={{ backgroundColor: `${color}18`, color }}
              >
                {ddayLabel(e.date)}
              </span>
              <span className="text-[12.5px] font-medium text-slate-400">
                {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
              </span>
            </div>

            <h3 className="mt-1.5 line-clamp-2 pr-10 text-[18px] font-extrabold leading-tight tracking-tight text-slate-900">
              {e.title}
            </h3>

            {/* 펼치기 화살표 — 우상단 고정 */}
            <span
              className="absolute right-4 top-3.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
              style={{ backgroundColor: `${color}14`, color }}
            >
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}
                strokeLinecap="round" strokeLinejoin="round"
                className="h-[15px] w-[15px]"
                style={{ transform: open ? "rotate(180deg)" : "none", transition: `transform ${EXPAND}` }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>

            {/* 하단 바 — 접힘 전용. absolute로 카드 전체 폭 사용 → 아바타가 오른쪽 끝에 딱 붙는다 */}
            <span
              className="absolute bottom-4 left-4 right-4 flex items-center justify-between"
              style={{
                opacity: open ? 0 : 1,
                pointerEvents: open ? "none" : "auto",
                transition: "opacity 180ms ease",
              }}
            >
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-slate-500">
                <ClockIcon className="h-[15px] w-[15px] shrink-0 text-slate-400" />
                {e.startTime
                  ? `${ampmTimeKo(e.startTime)}${e.endTime ? ` ~ ${ampmTimeKo(e.endTime, false)}` : ""}`
                  : "시간 미정"}
              </span>
              {going.length > 0 && <AvatarStack members={going} max={3} />}
            </span>
          </button>

          {/* ===== 펼친 상세 ===== */}
          <div
            className="overflow-hidden"
            style={{
              maxHeight: open ? 620 : 0,
              opacity: open ? 1 : 0,
              transition: `max-height ${EXPAND}, opacity 220ms ease`,
            }}
          >
            <div className="px-4 pb-4">
              <div className="space-y-2.5 rounded-2xl bg-slate-50 p-3.5">
                {/* 시간 */}
                <div className="flex items-center gap-2.5">
                  <ClockIcon className="h-[17px] w-[17px] shrink-0 text-slate-400" />
                  <span className="text-[14px] font-semibold text-slate-800">
                    {e.startTime
                      ? `${ampmTimeKo(e.startTime)}${e.endTime ? ` ~ ${ampmTimeKo(e.endTime, false)}` : ""}`
                      : "시간 미정"}
                  </span>
                </div>

                {/* 장소 — 접힘에선 뺐고 여기서만 보여 준다 */}
                <div className="flex items-center gap-2.5">
                  <PinIcon className="h-[17px] w-[17px] shrink-0 text-slate-400" />
                  <span className="min-w-0 truncate text-[14px] text-slate-700">
                    {e.location || "장소 미정"}
                  </span>
                </div>

                {/* 참여인원 — 누르면 참석·불참 명단 시트 */}
                <button
                  onClick={() => setRosterSheet(true)}
                  className="-mx-1 flex w-[calc(100%+8px)] items-center gap-2.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-slate-100/70"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px] shrink-0 text-slate-400">
                    <path d="M16 20v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
                    <circle cx="9" cy="7.5" r="3.5" />
                    <path d="M22 20v-1.6a4 4 0 0 0-3-3.87M16.5 4.13a4 4 0 0 1 0 6.74" />
                  </svg>
                  <span className="text-[14px] text-slate-700">
                    <strong className="font-bold text-slate-900">{going.length}명</strong> 참여
                    {absentMembers.length > 0 && (
                      <span className="text-slate-400"> · 불참 {absentMembers.length}명</span>
                    )}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {going.length > 0 && <AvatarStack members={going} max={5} size="h-6 w-6" />}
                    <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </button>

                {/* 메모 */}
                {e.memo && (
                  <p className="border-t border-slate-200/70 pt-2.5 text-[13px] leading-relaxed text-slate-500">
                    {e.memo}
                  </p>
                )}
              </div>

              {/* 참석 여부 세그먼트 토글 */}
              {myUid && (
                <>
                  <p className="mb-1.5 mt-3.5 px-0.5 text-[12px] font-semibold text-slate-400">
                    내 참석 여부
                  </p>
                  <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1">
                    <button
                      onClick={setAttend}
                      disabled={busy}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-bold transition ${
                        iAmGoing ? "bg-white text-emerald-600 shadow-sm" : "text-slate-400"
                      }`}
                    >
                      {iAmGoing && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-[14px] w-[14px]">
                          <polyline points="4 12.5 9.5 18 20 6.5" />
                        </svg>
                      )}
                      참석
                    </button>
                    <button
                      onClick={() => setReasonSheet(true)}
                      disabled={busy}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-bold transition ${
                        !iAmGoing ? "bg-white text-red-500 shadow-sm" : "text-slate-400"
                      }`}
                    >
                      {!iAmGoing && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" className="h-[14px] w-[14px]">
                          <circle cx="12" cy="12" r="9" />
                          <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
                        </svg>
                      )}
                      불참
                    </button>
                  </div>
                </>
              )}

              {/* 일정 페이지로 */}
              <button
                onClick={onOpenDetail}
                className="mt-2 w-full rounded-2xl py-2.5 text-[13px] font-semibold text-slate-400 transition hover:bg-slate-50"
              >
                일정에서 보기
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 참석·불참 명단 — 2열 그리드로 이름과 얼굴을 한눈에 */}
      <BottomSheet open={rosterSheet} title="참여 인원" onClose={() => setRosterSheet(false)}>
        <div className="space-y-5 pb-2">
          {/* 참석 */}
          <div>
            <p className="mb-2.5 text-[13px] font-semibold text-slate-500">
              참석 : <span className="text-slate-900">{going.length}명</span>
            </p>
            {going.length === 0 ? (
              <p className="py-3 text-center text-[13px] text-slate-400">아직 참석자가 없어요</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                {going.map((m) => (
                  <div key={m.uid} className="flex min-w-0 items-center gap-2.5">
                    <Avatar src={m.avatar} name={m.name} className="h-10 w-10" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-slate-800">
                      {m.name}
                      {m.uid === myUid && <span className="text-slate-400"> (나)</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 불참 */}
          {absentMembers.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2.5 text-[13px] font-semibold text-slate-500">
                불참 : <span className="text-slate-900">{absentMembers.length}명</span>
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                {absentMembers.map((m) => (
                  <div key={m.uid} className="flex min-w-0 items-center gap-2.5">
                    <span className="relative shrink-0">
                      <Avatar src={m.avatar} name={m.name} className="h-10 w-10 opacity-45" />
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-white bg-red-500">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" className="h-2.5 w-2.5">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-slate-400">
                        {m.name}
                        {m.uid === myUid && " (나)"}
                      </span>
                      {m.reason && (
                        <span className="block truncate text-[12px] text-slate-400">{m.reason}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* 불참 사유 — 사유는 선택, 비워도 그냥 불참 처리 */}
      <BottomSheet open={reasonSheet} title="이 날 못 가요" onClose={() => setReasonSheet(false)}>
        <div className="space-y-3">
          <p className="text-[13.5px] text-slate-500">
            <strong className="text-slate-800">{e.title}</strong> 일정에 참석이 어려우신가요?
          </p>
          {absentMembers.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[12px] font-semibold text-slate-500">
                🚫 못 가요 {absentMembers.length}명
              </p>
              <p className="mt-1 text-[13px] text-slate-400">
                {absentMembers.map((m) => m.name).join(", ")}
              </p>
            </div>
          )}

          <input
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="사유 (선택)"
            className="input w-full"
            onKeyDown={(ev) => {
              if (ev.key === "Enter") setAbsent();
            }}
          />
          <button
            onClick={setAbsent}
            disabled={busy}
            className="w-full rounded-2xl bg-red-500 py-3 text-[15px] font-bold text-white transition active:brightness-90 disabled:opacity-50"
          >
            불참으로 표시하기
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
