"use client";

// 펼쳐지는 일정 카드 — 홈 캐러셀과 일정 페이지 목록이 같이 쓴다.
//
// 카테고리는 색으로 구분한다 — 캐러셀은 카드에 스민 빛으로, 목록은 왼쪽 세로 바로:
//   전체 = 극단색 / A팀 = 민트 / B팀 = 라벤더 / 개별 지정·네이버 예약 = 주황
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

// 참고 시안의 색 가이드.
// 핵심은 "색을 상태 배지 한 곳에만 쓴다" — 제목·시간·아바타·화살표는 전부 무채색이라
// 카드가 컬러풀해 보이지 않으면서도 '오늘/D-데이'는 눈에 확 들어온다.
// 캐러셀 카드는 컬러 배경 + 흰 글씨라 본문 색은 따로 두지 않는다.
// 남은 건 상태 배지 색뿐 — 흰 알약 위에 이 색으로 글씨를 얹는다.
const SUB = "#8E8E93"; // 이미 지난 일정 배지 (D+N)
const TODAY = "#22C55E"; // 오늘
const DDAY = "#FF3B30"; // 다가오는 일정 (D-N)

// 카테고리 색.
// 카드 안에 '스며드는 빛'으로 쓰기 좋게 맞춘 값이라 예전보다 한 톤씩 부드럽다.
// 목록의 세로 컬러바에도 같은 색을 써서 화면마다 색이 달라지지 않게 한다.
export const COLORS = {
  // 전체 일정은 극단 설정 색을 그대로 쓴다 — 관리자가 브랜드 색을 바꾸면 같이 따라간다.
  // (10% 남짓한 틴트에서는 어떤 빨강을 써도 육안 차이가 거의 없다)
  all: "rgb(var(--accent))",
  teamA: "#72CFC3", // 첫 번째 팀 — 민트
  teamB: "#9B8BEA", // 두 번째 팀 — 라벤더
  // 개별 지정·네이버 예약 — 예전엔 네이버 초록이었으나 주황으로 통일했다.
  // 채도를 올린 주황이다. 앞서 쓰던 #E9A15A는 옅게 깔면 베이지로 주저앉아
  // 갈색처럼 탁하게 보였다.
  individual: "#F0851A",
} as const;

// ===== 카드를 채우는 멀티포인트 앰비언트 메시 =====
//
// 레퍼런스(토스 결제 카드)를 색 분포까지 뜯어보면 구조가 이렇다:
//   왼쪽에 진한 메인색이 세로로 길게 / 오른쪽 위에 밝은 보조색 /
//   가운데에서 둘이 섞이고 / 오른쪽 아래에 두 번째 강조색이 번진다.
// 한 방향으로 흐르는 linear가 아니라, 아주 크게 번진 radial 네 개가 겹쳐
// 경계 없이 섞이는 방식이다.
//
// 네 테마 모두 아래 '자리'는 똑같이 쓰고 색군만 갈아 끼운다.
// 그래야 색이 달라도 같은 디자인으로 보인다.
//
//   main  — 왼쪽 (제목·시간이 앉는 자리라 가장 진하다)
//   light — 오른쪽 위 (가장 밝은 보조색)
//   accent— 오른쪽 아래 (두 번째 색군)
//   soft  — 가운데 아래 (메인과 보조를 이어 주는 중간색)
//   base  — 빈 곳을 메우는 바탕
type Mesh = { base: string; main: string; soft: string; light: string; accent: string };

const MESH: Record<string, Mesh> = {
  // 전체 일정 — Red / Coral / Peach / Soft Pink
  [COLORS.all]: {
    base: "#F0706A",
    main: "#E24B4A",
    soft: "#F79273",
    light: "#FFCBA6",
    accent: "#F58FC0",
  },
  // A팀 — Mint / Aqua / Pale Green / Sky
  [COLORS.teamA]: {
    base: "#4CBFB0",
    main: "#189E90",
    soft: "#7FD8C6",
    light: "#BFF0DF",
    accent: "#86C9E8",
  },
  // B팀 — Purple / Lavender / Pink / Pale Blue
  [COLORS.teamB]: {
    base: "#9382E6",
    main: "#6E56D6",
    soft: "#B3A2F0",
    light: "#D9C8F5",
    accent: "#F0A8D8",
  },
  // 개별·네이버 — Orange / Apricot / Peach / Pale Yellow / Soft Coral
  // 레퍼런스와 가장 가까운 계열이다.
  [COLORS.individual]: {
    base: "#EE9440",
    main: "#E07316",
    soft: "#F3B06B",
    light: "#FBDFA0",
    accent: "#F2907A",
  },
};

/** 카드를 채우는 앰비언트 메시 배경.
 *
 *  ⚠️ 흰 글씨가 올라가므로 main은 충분히 진해야 한다. 밝은 색(light·accent)은
 *     글자가 없는 오른쪽에만 닿도록 자리를 잡아 뒀다.
 *  카드가 펼쳐져 길어져도 퍼센트라 같이 늘어나므로 앰비언트 느낌이 유지된다. */
export function cardMesh(color: string): React.CSSProperties {
  const m = MESH[color] ?? MESH[COLORS.all];
  return {
    backgroundColor: m.base,
    // 먼저 쓴 것이 위에 깔린다. 전부 transparent로 사라지므로 경계가 안 생긴다.
    backgroundImage: [
      `radial-gradient(125% 130% at 6% 38%, ${m.main} 0%, transparent 58%)`,
      `radial-gradient(95% 85% at 94% 2%, ${m.light} 0%, transparent 60%)`,
      `radial-gradient(90% 100% at 82% 100%, ${m.accent} 0%, transparent 60%)`,
      `radial-gradient(110% 95% at 46% 80%, ${m.soft} 0%, transparent 56%)`,
    ].join(", "),
  };
}

// 컬러 카드 위 작은 글씨는 배경 밝기가 자리마다 달라 그냥 흰색이면 흐려 보인다.
// 아주 옅은 그림자 한 겹으로 어디서든 또렷하게 붙잡아 준다.
const ON_MESH_SHADOW = "0 1px 2px rgba(16,24,40,0.28)";

/** 일정 하나가 어떤 색을 쓸지 */
export function eventColor(e: ScheduleEvent, teams: string[]): string {
  if (e.source === "naver") return COLORS.individual;
  // 개별 지정 일정도 같은 주황 (팀 지정과 시각적으로 다름을 알림)
  if (e.participantUids && e.participantUids.length > 0) return COLORS.individual;
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
  overlap = -9,
}: {
  members: Member[];
  max?: number;
  size?: string;
  /** 겹침 정도 — 음수가 클수록 많이 겹친다 (기본 -9) */
  overlap?: number;
}) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <div
          key={m.uid}
          className="rounded-full bg-white p-[1.5px]"
          style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: shown.length - i }}
        >
          <Avatar src={m.avatar} name={m.name} className={size} />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="grid place-items-center rounded-full bg-white p-[1.5px]"
          style={{ marginLeft: overlap, zIndex: 0 }}
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

  // 펼친 상세에서 쓰는 전체 시간 (시작 ~ 종료)
  const timeLabel = e.startTime
    ? `${ampmTimeKo(e.startTime)}${e.endTime ? ` ~ ${ampmTimeKo(e.endTime, false)}` : ""}`
    : "시간 미정";
  // 접힌 카드에서는 시작 시각만. 끝나는 시각까지 넣으면 줄이 길어지고,
  // 접힌 상태에서 정말 필요한 건 '몇 시에 시작하나'뿐이다.
  const startLabel = e.startTime ? ampmTimeKo(e.startTime) : "시간 미정";

  // 이 일정을 만든 사람 — 단원 예약이 승인돼 만들어진 일정에만 기록돼 있다.
  // 명단에서 못 찾으면(탈퇴 등) 줄 자체를 띄우지 않는다.
  const creator = e.createdBy ? members.find((m) => m.uid === e.createdBy) : undefined;

  // 펼치기 화살표.
  // 캐러셀은 배경 없이 아이콘만 — 색을 빼서 '상태 배지'만 눈에 띄게 남긴다.
  // 목록(일정 페이지)은 기존 색 원을 그대로 쓴다.
  const chevron = (
    <span
      className={
        variant === "carousel"
          ? "grid h-5 w-5 shrink-0 place-items-center"
          : "grid h-7 w-7 shrink-0 place-items-center rounded-full"
      }
      style={
        variant === "carousel"
          ? { color: "rgba(255,255,255,0.82)" }
          : { backgroundColor: tint, color }
      }
    >
      <svg
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}
        strokeLinecap="round" strokeLinejoin="round"
        className={variant === "carousel" ? "h-4 w-4" : "h-[15px] w-[15px]"}
        style={{ transform: open ? "rotate(180deg)" : "none", transition: `transform ${EXPAND}` }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );

  // 캐러셀 전용 날짜 라벨 — "9월 2일 (수)"
  const dateFull = `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WEEKDAYS_KO[dt.getDay()]})`;

  // 상태 배지 — 카드에서 색을 쓰는 유일한 곳.
  //   오늘 = 초록 / 앞으로 남은 일정 = 빨강 / 이미 지난 일정 = 회색
  const dday = ddayLabel(e.date);
  const statusColor = dday.startsWith("D+") ? SUB : dday === "오늘" ? TODAY : DDAY;
  // 배경은 같은 색을 12%만 섞은 tint — 배지가 '칩'으로 읽히되 카드를 물들이진 않는다
  const statusBg = `color-mix(in srgb, ${statusColor} 12%, transparent)`;

  // ===== 접힘 머리 ① 홈 캐러셀 =====
  // 참고 시안 구조 — 읽는 순서: 언제(배지·날짜) → 무엇(제목) → 몇 시(시간) → 누가(아바타).
  // 제목칸은 2줄 높이로 못 박아 뒀다 — 제목이 한 줄이어도 아래 시간줄 위치가 카드마다 같다.
  const carouselHead = (
          <button
            onClick={onToggle}
            aria-expanded={open}
            className={`relative w-full px-4 pt-4 text-left ${
              open ? "" : "flex flex-1 flex-col justify-start"
            }`}
            style={{ paddingBottom: open ? 12 : 0 }}
          >
            {/* ① 상태 배지 + 날짜 + 펼치기.
                컬러 배경 위에서는 옅은 tint 배지가 묻히므로 흰 알약에 상태색 글씨로 뒤집는다 */}
            <div className="flex items-center gap-2">
              <span
                className="shrink-0 rounded-full bg-white px-2 py-[3px] text-[11px] font-bold leading-none"
                style={{ color: statusColor }}
              >
                {dday}
              </span>
              <span
                className="truncate text-[13px] font-semibold text-white/90"
                style={{ textShadow: ON_MESH_SHADOW }}
              >
                {dateFull}
              </span>
              {badge}
              <span className="ml-auto">{chevron}</span>
            </div>

            {/* ② 제목 — 카드에서 가장 큰 글자 */}
            <h3
              className={`mt-2.5 line-clamp-2 h-[46px] text-[17px] font-bold leading-[23px] tracking-tight text-white ${
                dimmed ? "line-through" : ""
              }`}
              style={{ textShadow: ON_MESH_SHADOW }}
            >
              {e.title}
            </h3>

            {/* ③ 시작 시각 — 펼치면 감춘다.
                펼친 상세 맨 위에 같은 시간이 다시 나오므로 두 번 읽힐 이유가 없다. */}
            {!open && (
              <div
                className="mt-2 flex items-center gap-1.5 text-white/90"
                style={{ textShadow: ON_MESH_SHADOW }}
              >
                <ClockIcon className="h-[15px] w-[15px] shrink-0" />
                <span className="truncate text-[13px] font-semibold">{startLabel}</span>
              </div>
            )}

            {/* ④ 아바타 — 카드 오른쪽 아래. 접힘 전용 (펼치면 상세에 참여인원이 따로 나온다) */}
            <span
              className="absolute bottom-3.5 right-4 flex items-center"
              style={{
                opacity: open ? 0 : 1,
                pointerEvents: open ? "none" : "auto",
                transition: "opacity 180ms ease",
              }}
            >
              {going.length > 0 && <AvatarStack members={going} max={4} size="h-6 w-6" overlap={-10} />}
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
            {/* 펼친 내용은 흰 패널 한 장 위에 올린다.
                카드 전체가 컬러라 검은 글씨를 그냥 얹으면 자리마다 밝기가 달라 안 읽힌다.
                패널을 반투명으로 둬서 아래 색이 은은히 비치게 했다 — 색은 이어지고
                글씨는 또렷한 절충점이다. list 변형은 원래 흰 카드라 패널이 필요 없다. */}
            <div className={variant === "carousel" ? "px-3 pb-3" : "px-4 pb-4"}>
              <div
                className={
                  variant === "carousel"
                    ? "rounded-[22px] bg-white/92 p-3 backdrop-blur-sm"
                    : "contents"
                }
              >
              <div className="space-y-2.5 rounded-2xl bg-slate-50 p-3.5">
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

                {/* 만든 사람 — createdBy가 기록된 일정에만 나온다.
                    (단원 예약이 승인돼 만들어진 일정과, 이후 관리자가 등록한 일정) */}
                {creator && (
                  <div className="flex items-center gap-2.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px] shrink-0 text-slate-400">
                      <circle cx="12" cy="8" r="3.6" />
                      <path d="M5.5 20v-1.2a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20" />
                    </svg>
                    <span className="min-w-0 truncate text-[14px] text-slate-700">
                      <strong className="font-semibold text-slate-900">{creator.name}</strong>
                      님이 등록
                    </span>
                  </div>
                )}

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
          </div>
  );

  return (
    <div
      className={`relative overflow-hidden ${
        variant === "list"
          ? "rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03),0_6px_16px_-12px_rgba(16,24,40,0.1)]"
          : // 큰 라운드 + 옅은 그림자. 색이 이미 카드를 세워 주므로 그림자는 거들기만 한다.
            "mesh-grain rounded-[28px] shadow-[0_4px_16px_-6px_rgba(16,24,40,0.16)]"
      } ${dimmed ? "opacity-60" : ""} ${wrapperClassName}`}
      // 메시는 카드 '전체'에 건다 — 펼쳐서 길어져도 색이 끝까지 이어진다.
      // 목록(list)은 흰 카드 그대로 두고 왼쪽 세로 바로 구분한다.
      style={variant === "list" ? wrapperStyle : { ...wrapperStyle, ...cardMesh(color) }}
    >
      {variant === "list" ? (
        <>
          {listHead}
          {detail}
        </>
      ) : (
        // 카드가 높이를 고정으로 갖는다 → 안쪽도 그 높이를 이어받아야
        // 아바타가 카드 바닥에 붙는다 (안 그러면 내용이 위에만 뭉친다)
        //
        // 왼쪽 팀색 바는 뺐다 — 참고 시안의 핵심이 '색은 상태 배지에만'이라,
        // 바까지 남기면 한 카드에 색이 두 곳이 되어 축소 효과가 반감된다.
        // 팀 구분 색은 일정 페이지 목록(list 변형)에 그대로 살아 있다.
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
