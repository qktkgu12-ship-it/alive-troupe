"use client";

// 펼쳐지는 일정 카드 — 홈 캐러셀과 일정 페이지 목록이 같이 쓴다.
//
// 흰 바탕 + 왼쪽 세로 색 바로 일정 성격을 구분한다:
//   전체 일정 = 빨강 / A팀 = 민트 / B팀 = 보라 / 네이버 예약·개별 지정 = 네이버 초록
//
// 접힘: 날짜·D-day / 제목(2줄 고정) / 시간 / 참여인원 아바타
//   제목 칸을 2줄 높이로 고정해 뒀다 — 제목이 짧든 길든 D-day·시간줄 위치가 같다.
// 펼침: 접힘에서 보이던 시간·아바타 줄은 사라지고(펼친 내용과 중복) 상세로 대체된다.

import { useMemo, useState } from "react";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Avatar from "@/components/Avatar";
import BottomSheet from "@/components/BottomSheet";
import { ClockIcon, PinIcon } from "@/components/Icons";
import { ampmTimeKo, bookingWhenLabel, WEEKDAYS_KO } from "@/lib/utils";
import { pushToAdmins, pushToUsers } from "@/lib/push";
import type { ScheduleEvent } from "@/lib/types";

// 펼침/접힘 — 높이가 늘어나는 건 차분하게
export const EXPAND = "360ms cubic-bezier(0.32, 0.72, 0.28, 1)";

// 팀 색은 일정 달력(TEAM_PALETTE)과 같은 색조·채도를 쓴다.
export const COLORS = {
  all: "rgb(var(--accent))", // 전체 일정 — 극단 브랜드 색(accent)
  teamA: "#19BDA4", // 첫 번째 팀 — 달력 민트를 어둡게
  teamB: "#7A2FF2", // 두 번째 팀
  // 네이버 예약·개별 지정 일정은 같은 초록을 쓴다 (네이버 공식 초록 = 관리 버튼 색)
  green: "#03C75A",
} as const;

/** 일정 하나가 어떤 색을 쓸지 */
export function eventColor(e: ScheduleEvent, teams: string[]): string {
  if (e.source === "naver") return COLORS.green;
  // 개별 지정 일정도 같은 초록 (팀 지정과 시각적으로 다름을 알림)
  if (e.participantUids && e.participantUids.length > 0) return COLORS.green;
  if (!e.team) return COLORS.all;
  const i = teams.indexOf(e.team);
  if (i === 0) return COLORS.teamA;
  if (i === 1) return COLORS.teamB;
  return COLORS.all;
}

export function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function ddayLabel(dateStr: string) {
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

// "HH:mm" → { time: "H:MM", ampm: "AM"|"PM" } — 일정 목록 카드의 왼쪽 시간칸용
function formatTimeParts(t: string | undefined): { time: string; ampm: string } {
  if (!t) return { time: "—", ampm: "" };
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { time: `${hour}:${String(m).padStart(2, "0")}`, ampm };
}

// 카드에 쓰는 최소 프로필 (publicProfiles)
export type Member = { uid: string; name: string; avatar?: string; team?: string };

/** 겹쳐 놓은 아바타 줄 — 뒤 아바타가 앞 아바타에 살짝 물린다 */
export function AvatarStack({
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

export default function EventCard({
  e,
  color,
  open,
  onToggle,
  members,
  absences,
  extraUids,
  myUid,
  myName,
  onChanged,
  onOpenDetail,
  onEdit,
  onDelete,
  dimmed = false,
  badge,
  titlePrefix,
  variant = "carousel",
  wrapperClassName = "",
  wrapperStyle,
}: {
  e: ScheduleEvent;
  color: string;
  open: boolean;
  onToggle: () => void;
  members: Member[];
  absences: { uid: string; reason: string }[];
  extraUids: string[];
  myUid: string;
  myName: string;
  onChanged: () => void;
  /** 있으면 '일정에서 보기' 버튼을 보여 준다 (홈 캐러셀 전용) */
  onOpenDetail?: () => void;
  /** 있으면 '일정 수정' 버튼 (관리자) */
  onEdit?: () => void;
  /** 있으면 '일정 삭제' 버튼 (관리자 또는 본인이 예약한 일정) */
  onDelete?: () => void;
  /** 지난 일정·숨긴 일정 흐리게 */
  dimmed?: boolean;
  /** 제목 옆 배지 (숨김/지남 등) */
  badge?: React.ReactNode;
  /** 제목 앞 배지 (팀 칩 등) — list 변형에서만 */
  titlePrefix?: React.ReactNode;
  /**
   * carousel = 홈 캐러셀용 큰 카드 (D-day·제목 2줄칸·아바타 줄)
   * list     = 일정 페이지 목록용 한 줄 카드 (왼쪽 시간칸 + 색 바 + 제목)
   * 접힘 모습만 다르고, 펼친 상세는 둘이 똑같다.
   */
  variant?: "carousel" | "list";
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
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
  const { going, iAmBase, iAmGoing, baseUids } = useMemo(() => {
    const picked = e.participantUids ?? [];
    const base =
      picked.length > 0
        ? members.filter((m) => picked.includes(m.uid))
        : members.filter((m) => (e.team ? m.team === e.team : true));
    const baseSet = new Set(base.map((m) => m.uid));
    const extra = members.filter((m) => extraUids.includes(m.uid) && !baseSet.has(m.uid));
    const absent = new Set(absences.map((a) => a.uid));
    const list = [...base, ...extra].filter((m) => !absent.has(m.uid));
    return {
      going: list,
      iAmBase: baseSet.has(myUid),
      iAmGoing: list.some((m) => m.uid === myUid),
      baseUids: [...baseSet],
    };
  }, [members, extraUids, absences, e.team, e.participantUids, myUid]);

  // 이 일정이 '개별 지정'인지 — 알림을 관리자에게 보낼지 대상 인원에게 보낼지 가른다
  const isIndividual = (e.participantUids ?? []).length > 0;

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
        // 대상이 아닌 사람이 합류하면 인원이 늘어난다 —
        // 원래 대상 인원 전원에게 알려 준비(자리·대본 등)를 맞출 수 있게 한다.
        // (이미 대상인 사람이 참석을 누른 건 알릴 일이 아니다)
        const to = baseUids.filter((u) => u && u !== myUid);
        if (to.length > 0) {
          void pushToUsers(to, {
            title: `[참석 추가] ${e.title}`,
            body: [
              `${myName || "단원"}님이 참석하기로 했어요.`,
              bookingWhenLabel(e.date, e.startTime ?? "", e.endTime ?? ""),
            ]
              .filter(Boolean)
              .join("\n"),
            href: `/schedule?tab=events&date=${e.date}`,
            tag: `attend-${e.id}`,
          });
        }
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
      // 불참 알림 — 누가 알아야 하는지는 일정 성격에 따라 다르다.
      //   전체·팀 일정  → 관리자 (인원 파악은 관리자 몫)
      //   개별 지정 일정 → 같이 하기로 한 대상 인원 (소수라 서로 조율이 필요하다)
      const absentMsg = {
        title: `[불참] ${e.title}`,
        body: [
          `${myName || "단원"}님이 불참을 알렸어요.`,
          bookingWhenLabel(e.date, e.startTime ?? "", e.endTime ?? ""),
          reason.trim() ? `사유: ${reason.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        href: `/schedule?tab=events&date=${e.date}`,
        tag: `absence-${e.id}`,
      };
      if (isIndividual) {
        const to = baseUids.filter((u) => u && u !== myUid);
        if (to.length > 0) void pushToUsers(to, absentMsg);
      } else {
        void pushToAdmins(absentMsg);
      }
      setReason("");
      setReasonSheet(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // 색은 hex일 수도, rgb(var(--accent))일 수도 있어서 hex 알파(#RRGGBBAA)를 못 쓴다.
  // color-mix로 어떤 형식이든 같은 농도의 연한 배경을 만든다.
  const tint = `color-mix(in srgb, ${color} 10%, transparent)`;
  // 홈 캐러셀 카드는 바탕 자체를 그 일정 색의 연한 면으로 칠한다.
  const cardBg = `color-mix(in srgb, ${color} 16%, white)`;
  // 펼친 상세 — 색 카드 위에서는 회색 면이 탁해 보인다. 흰 면으로 띄우고,
  // 세그먼트 토글만 카드보다 한 단계 진한 색 면으로 눌러 준다.
  const panelBg = variant === "carousel" ? "#ffffff" : "rgb(248 250 252)";
  const segBg = variant === "carousel" ? `color-mix(in srgb, ${color} 26%, white)` : "rgb(241 245 249)";
  // 그 바탕 위에서는 10% 칩이 묻혀 안 보인다 → 칩·화살표는 흰 면으로 띄운다.
  const chipBg = variant === "carousel" ? "#ffffff" : tint;

  const timeLabel = e.startTime
    ? `${ampmTimeKo(e.startTime)}${e.endTime ? ` ~ ${ampmTimeKo(e.endTime, false)}` : ""}`
    : "시간 미정";

  // 펼치기 화살표 — 두 변형이 같이 쓴다
  const chevron = (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
      style={{ backgroundColor: chipBg, color }}
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
  );

  // ===== 접힘 머리 ① 홈 캐러셀 =====
  // D-day줄·제목칸(2줄 고정)·하단바 자리를 전부 못박아 뒀다.
  // 제목 길이에 따라 위 아래가 밀리지 않는다.
  const carouselHead = (
          <button
            onClick={onToggle}
            aria-expanded={open}
            // 접힘일 때 남는 높이를 이 버튼이 다 먹어야 하단 줄이 카드 바닥에 앉는다.
            // button은 내용을 세로 가운데로 모으는 성질이 있어서, 늘어나면
            // D-day·날짜·제목이 카드 한가운데로 밀린다 → flex-col + 위 정렬로 못 박는다.
            className={`relative w-full px-3.5 pt-3.5 text-left ${
              open ? "" : "flex flex-1 flex-col justify-start"
            }`}
            style={{ paddingBottom: open ? 12 : 52 }}
          >
            {/* D-day + 날짜 */}
            <div className="flex h-5 items-center gap-1.5 pr-10">
              <span
                className="rounded-full px-2 py-[2px] text-[11px] font-extrabold"
                style={{ backgroundColor: chipBg, color }}
              >
                {ddayLabel(e.date)}
              </span>
              <span className="text-[12.5px] font-medium text-slate-400">
                {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
              </span>
            </div>

            {/* 제목 — 2줄 높이 고정칸. 한 줄이어도 아래 줄이 안 올라온다 */}
            <div className="mt-1.5 flex h-[46px] items-start pr-10">
              <h3
                className={`line-clamp-2 text-[18px] font-extrabold leading-[23px] tracking-tight ${
                  dimmed ? "text-slate-400 line-through" : "text-slate-900"
                }`}
              >
                {e.title}
              </h3>
              {badge}
            </div>

            {/* 펼치기 화살표 — 우상단 고정 */}
            <span className="absolute right-3.5 top-3.5">{chevron}</span>

            {/* 하단 바 — 접힘 전용. absolute로 카드 전체 폭 사용 → 아바타가 오른쪽 끝에 딱 붙는다 */}
            <span
              className="absolute bottom-4 left-3.5 right-3.5 flex items-center justify-between"
              style={{
                opacity: open ? 0 : 1,
                pointerEvents: open ? "none" : "auto",
                transition: "opacity 180ms ease",
              }}
            >
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-slate-500">
                <ClockIcon className="h-[15px] w-[15px] shrink-0 text-slate-400" />
                {timeLabel}
              </span>
              {going.length > 0 && <AvatarStack members={going} max={3} />}
            </span>
          </button>
  );

  // ===== 접힘 머리 ② 일정 페이지 목록 =====
  // 예전 한 줄 카드 그대로 — 왼쪽 시간칸 / 색 바 / 제목·장소 — 에 펼치기 화살표만 붙였다.
  const listHead = (
    <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center text-left">
      {/* 시간 */}
      <div className="flex w-[72px] shrink-0 flex-col justify-center px-3 py-3">
        {(() => {
          const sp = formatTimeParts(e.startTime);
          return (
            <p className={`whitespace-nowrap text-[17px] font-bold leading-tight tracking-tighter ${
              dimmed ? "text-slate-400 line-through" : "text-slate-900"
            }`}>
              {sp.time}
              <span className="ml-[3px] text-[10px] font-semibold tracking-normal">{sp.ampm}</span>
            </p>
          );
        })()}
        {e.endTime && (() => {
          const ep = formatTimeParts(e.endTime);
          return (
            <p className="mt-0.5 whitespace-nowrap text-[12px] font-medium tracking-tighter text-slate-400">
              {ep.time}
              <span className="ml-[3px] text-[9px] tracking-normal">{ep.ampm}</span>
            </p>
          );
        })()}
      </div>
      {/* 컬러 바 — 얇은 세로선 */}
      <div className="flex self-stretch py-3">
        <div className="w-1 flex-1 rounded-full" style={{ backgroundColor: color }} />
      </div>
      {/* 내용 */}
      <div className="min-w-0 flex-1 py-3 pl-3 pr-2">
        <p className="flex items-center gap-1.5 text-[17px] font-bold tracking-tighter text-slate-900">
          {titlePrefix}
          <span className={`min-w-0 truncate ${dimmed ? "text-slate-400 line-through" : ""}`}>
            {e.title}
          </span>
          {badge}
        </p>
        {(e.location || e.memo) && (
          <p className={`mt-0.5 line-clamp-1 text-[11px] tracking-tighter text-slate-400 ${dimmed ? "line-through" : ""}`}>
            {[e.location, e.memo].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <span className="mr-3">{chevron}</span>
    </button>
  );

  // ===== 펼친 상세 — 두 변형이 똑같이 쓴다 =====
  const detail = (
          <div
            className="overflow-hidden"
            style={{
              maxHeight: open ? 680 : 0,
              opacity: open ? 1 : 0,
              transition: `max-height ${EXPAND}, opacity 220ms ease`,
            }}
          >
            <div className={`pb-4 ${variant === "list" ? "px-4" : "px-3.5"}`}>
              <div className="space-y-2.5 rounded-2xl p-3.5" style={{ backgroundColor: panelBg }}>
                {/* 시간 */}
                <div className="flex items-center gap-2.5">
                  <ClockIcon className="h-[17px] w-[17px] shrink-0 text-slate-400" />
                  <span className="text-[14px] font-semibold text-slate-800">{timeLabel}</span>
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
                  <div className="flex gap-1.5 rounded-2xl p-1" style={{ backgroundColor: segBg }}>
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

              {/* 관리자·본인 예약: 수정·삭제 아이콘 */}
              {(onEdit || onDelete) && (
                <div className="mt-2 flex justify-end gap-2">
                  {onEdit && (
                    <button
                      onClick={onEdit}
                      aria-label="일정 수정"
                      className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
                        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={onDelete}
                      aria-label="일정 삭제"
                      className="grid h-9 w-9 place-items-center rounded-full border border-red-100 text-red-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
                        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* 일정 페이지로 */}
              {onOpenDetail && (
                <button
                  onClick={onOpenDetail}
                  className="mt-2 w-full rounded-2xl py-2.5 text-[13px] font-semibold text-slate-400 transition hover:bg-slate-50"
                >
                  일정에서 보기
                </button>
              )}
            </div>
          </div>
  );

  return (
    <div
      className={`overflow-hidden ${
        variant === "list"
          ? "rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03),0_6px_16px_-12px_rgba(16,24,40,0.1)]"
          : "rounded-3xl shadow-[0_2px_10px_-6px_rgba(16,24,40,0.12)]"
      } ${dimmed ? "opacity-60" : ""} ${wrapperClassName}`}
      style={variant === "list" ? wrapperStyle : { backgroundColor: cardBg, ...wrapperStyle }}
    >
      {variant === "list" ? (
        <>
          {listHead}
          {detail}
        </>
      ) : (
        // 카드가 4:3 비율로 높이를 갖는다 → 안쪽도 그 높이를 이어받아야
        // 시간·아바타 줄이 카드 바닥에 붙는다 (안 그러면 내용이 위에만 뭉친다)
        // 왼쪽 색 바는 뺐다 — 카드 바탕색이 이미 같은 일을 한다.
        <div className="flex h-full flex-col">
          {carouselHead}
          {detail}
        </div>
      )}

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
      <BottomSheet open={reasonSheet} title="불참 신청" onClose={() => setReasonSheet(false)}>
        <div className="space-y-3">
          <p className="text-[13.5px] text-slate-500">
            <strong className="text-slate-800">{e.title}</strong> 일정에 참석이 어려우신가요?
          </p>
          {absentMembers.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[12px] font-semibold text-slate-500">
                이미 불참한 단원 {absentMembers.length}명
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
            style={{ backgroundColor: "rgb(var(--accent))" }}
            className="w-full rounded-2xl py-3 text-[15px] font-bold text-accent-fg transition active:brightness-90 disabled:opacity-50"
          >
            불참으로 표시하기
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
