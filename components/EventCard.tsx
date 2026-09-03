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

// D-day 칩(흰 알약) 안 글자색.
// 캐러셀 카드는 컬러 배경 + 흰 글씨라 본문에는 색을 따로 두지 않는다.
// 색이 붙는 곳은 이 칩 하나뿐이고, 그마저도 '오늘'에만 준다 —
// 다가오는 날짜까지 색을 주면 어느 게 급한 건지 구분이 안 된다.
const TODAY = "#E5484D"; // 오늘 — 유일하게 색이 붙는다
const UPCOMING = "#334155"; // 그 외 (D-N) — 진한 회색. 흐리면 꺼진 칩처럼 보인다
const PAST = "#94A3B8"; // 이미 지난 일정 (D+N)

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
type Mesh = {
  base: string; // 빈 곳을 메우는 바탕
  main: string; // 왼쪽 — 흰 글씨가 앉는 자리라 가장 진하다
  light: string; // 오른쪽 위 — 가장 밝은 색
  accent: string; // 아래 가운데~오른쪽 — 색군이 확 바뀌는 자리
  soft: string; // 가운데 아래 — 메인과 강조색을 잇는 중간색
  hint: string; // 오른쪽 가장자리 — 다른 계열이 아주 살짝
};

const MESH: Record<string, Mesh> = {
  // 전체 — Red / Coral / Pink / Peach / Warm Yellow
  [COLORS.all]: {
    base: "#EE6B62",
    main: "#DF3F3E",
    light: "#FBD79B",
    accent: "#F084BE",
    soft: "#FFBE9E",
    hint: "#E2A6D8",
  },
  // A팀 — Mint / Aqua / Soft Green / Pale Blue
  [COLORS.teamA]: {
    base: "#46BCAE",
    main: "#10A093",
    light: "#D3F3E2",
    accent: "#7FC4E8",
    soft: "#74D6C4",
    hint: "#A9E0F0",
  },
  // B팀 — Purple / Lavender / Pink / Pale Blue
  [COLORS.teamB]: {
    base: "#8F7DE4",
    main: "#6A50D4",
    light: "#DFD1F8",
    accent: "#F0A3D5",
    soft: "#AC9BEE",
    hint: "#A9BCF0",
  },
  // 개별·네이버 — Orange / Peach / Coral / Pale Yellow / subtle Pink·Lavender
  // 레퍼런스와 가장 가까운 계열이다.
  //
  // ⚠️ 주황이 계속 '칙칙하다(황토색 같다)'고 했던 이유는 채도가 아니라 두 가지였다.
  //    재 보면 이 카드의 채도는 오히려 빨강·민트·보라보다 높았다.
  //    ① 갈색은 '어두운 주황'이다 — 밝기를 올리지 않으면 아무리 채도를 올려도
  //       황토색으로 읽힌다. 카드 평균 밝기를 0.935 → 0.981로 올렸다.
  //    ② 색상각이 28°(노랑 쪽)이었다. 23°(귤 쪽)로 당기면 같은 밝기라도
  //       '탁한 주황'이 아니라 '선명한 귤색'으로 보인다.
  //    제목 자리 대비는 2.99 → 2.92로 사실상 그대로다 (흰 글씨 가독성 유지).
  //    되돌리려면 아래 여섯 값을 예전 값으로: base #EF9A4E · main #E4710D ·
  //    light #FBE3A2 · accent #F58FAF · soft #F9AE7C · hint #E0A9E4
  [COLORS.individual]: {
    base: "#FA9C4A",
    main: "#F8640F",
    light: "#FFE8A4",
    accent: "#FF7FB2",
    soft: "#FFB37A",
    // 라벤더는 회색기가 적은 쪽으로. 채도가 낮으면 주황과 섞일 때
    // 회보라가 되어 카드가 탁해진다. 분홍 쪽으로 당겨 따뜻하게 잡았다.
    hint: "#F09EF0",
  },
};

/** #RRGGBB → 같은 색의 '투명한 판' (rgba(r,g,b,0)).
 *
 *  ⚠️ 그라데이션 끝을 `transparent`로 쓰면 안 되는 이유:
 *     CSS의 transparent는 '투명한 검정'이다. 요즘 브라우저는 알파를 미리 곱해
 *     계산하므로 검정이 안 섞이지만, 사파리(특히 iOS)는 이 처리가 브라우저·기기마다
 *     달라서 색이 사라지는 구간에 회색기가 끼어든다.
 *     → 색은 그대로 두고 알파만 0으로 떨어뜨리면 어디서 그리든 같은 색이 나온다.
 *     주황이 유독 탁해 보이던 것도 이 회색기 때문일 가능성이 크다. */
function fade(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

/** 카드를 채우는 앰비언트 메시 배경.
 *
 *  ⚠️ 흰 글씨가 올라가므로 main은 충분히 진해야 한다. 밝은 색(light·accent)은
 *     글자가 없는 오른쪽에만 닿도록 자리를 잡아 뒀다.
 *  카드가 펼쳐져 길어져도 퍼센트라 같이 늘어나므로 앰비언트 느낌이 유지된다.
 *
 *  색은 전부 sRGB 16진값 하나로 통일했다 — color-mix·hsl·oklch를 섞어 쓰면
 *  브라우저마다 보간하는 색 공간이 달라져 같은 코드가 다른 색으로 나온다. */
export function cardMesh(color: string): React.CSSProperties {
  const m = MESH[color] ?? MESH[COLORS.all];
  return {
    backgroundColor: m.base,
    // 먼저 쓴 것이 위에 깔린다. 전부 알파 0으로 사라지므로 경계가 안 생긴다.
    //
    // 메인은 왼쪽 절반 남짓만 덮는다. 예전엔 125%×130%로 카드를 거의 다 덮어서
    // 나머지 색이 나올 자리가 없었고, 그래서 '주황 → 살구' 한 방향으로만 흘렀다.
    // 자리를 비워 주니 노랑·핑크·라벤더가 각자 빛 덩어리로 드러난다.
    backgroundImage: [
      `radial-gradient(100% 108% at 0% 40%, ${m.main} 0%, ${fade(m.main)} 58%)`,
      `radial-gradient(70% 66% at 98% 0%, ${m.light} 0%, ${fade(m.light)} 60%)`,
      `radial-gradient(76% 72% at 64% 100%, ${m.accent} 0%, ${fade(m.accent)} 58%)`,
      `radial-gradient(58% 56% at 100% 60%, ${m.hint} 0%, ${fade(m.hint)} 62%)`,
      `radial-gradient(88% 74% at 46% 82%, ${m.soft} 0%, ${fade(m.soft)} 58%)`,
    ].join(", "),
  };
}

// 카드의 주인공은 여러 색이 퍼지는 그라데이션이다. 글자에 그림자를 얹으면
// 그 위에 검은 테두리가 한 겹 생겨 빛의 느낌이 깨진다.
// 제목처럼 굵은 글씨는 그림자 없이 흰색만 쓰고,
// 작은 보조 글씨(날짜·시간)에만 아주 미세하게 한 겹 — blur도 glow도 아니다.
const ON_MESH_SHADOW = "0 1px 4px rgba(0,0,0,0.08)";

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

  // 상태 배지 — 오늘만 빨강, 나머지는 진한 회색.
  const dday = ddayLabel(e.date);
  const statusColor = dday.startsWith("D+") ? PAST : dday === "오늘" ? TODAY : UPCOMING;

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
              {/* 위아래 안여백이 3/3이 아니라 4/2다 — 일부러 어긋나게 뒀다.
                  글자는 line-height 상자의 '가운데'가 아니라 폰트가 정해 둔 기준선 위에
                  그려지는데, 그 기준선 위치가 폰트마다 다르다.
                  PC(Pretendard)는 거의 정가운데지만, 폰은 이 글꼴이 없어 다른 글꼴로
                  대체되고 그 글꼴은 글자를 1px쯤 위에 그린다 → 칩 안에서 위로 뜬 것처럼 보인다.
                  위쪽을 1px 더 벌려 눈에 보이는 위치를 가운데로 맞췄다 (칩 높이는 그대로).
                  ※ 근본 해결은 Pretendard를 웹폰트로 실어 PC·폰이 같은 글꼴을 쓰게 하는 것. */}
              <span
                className="shrink-0 rounded-full bg-white px-2 pb-[2px] pt-[4px] text-[11px] font-bold leading-none"
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
              // 제목은 굵고 커서 그림자 없이도 또렷하다 — 그림자를 넣으면
              // 글자 테두리가 지저분해지고 그라데이션의 빛도 탁해진다.
              className={`mt-2.5 line-clamp-2 h-[46px] text-[17px] font-bold leading-[23px] tracking-tight text-white ${
                dimmed ? "line-through" : ""
              }`}
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
            {/* 컬러 카드에서는 '정보 박스'만 흰 패널로 띄우고,
                라벨·토글·버튼은 그라데이션 위에 흰 글씨로 직접 올린다.
                전부 흰 패널에 담으면 카드 아래쪽이 흰 상자로 덮여 색이 끊긴다. */}
            <div className={variant === "carousel" ? "px-3 pb-3" : "px-4 pb-4"}>
              <div
                className={
                  variant === "carousel"
                    ? // backdrop-blur는 뺐다 — 이미 90% 흰 판이라 뿌옇게 할 배경이
                      // 거의 안 비치는데, 이것 하나 때문에 카드 전체가 GPU 합성
                      // 레이어로 올라가 기기마다 색이 달라질 여지가 생긴다.
                      "space-y-2.5 rounded-[20px] bg-white/90 p-3.5"
                    : "space-y-2.5 rounded-2xl bg-slate-50 p-3.5"
                }
              >
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
                  <p
                    className={`mb-1.5 mt-3.5 px-0.5 text-[12px] font-semibold ${
                      variant === "carousel" ? "text-white" : "text-slate-400"
                    }`}
                    // 작은 글씨라 밝은 배경 위에서 가장 먼저 묻힌다.
                    // 그림자는 윤곽만 잡아 주는 정도(알파 0.08)로만 — 글자에 테를 두르지 않는다.
                    style={variant === "carousel" ? { textShadow: ON_MESH_SHADOW } : undefined}
                  >
                    내 참석 여부
                  </p>
                  {/* 토글 트랙 — 컬러 위에서는 '살짝 눌린 자리' + 흰 테두리.
                      반투명 흰색을 깔았더니 아예 안 보였다. 카드 아래쪽이 이미
                      밝은 살구·분홍(밝기 47%)이라 흰색을 더 얹으면 배경과 같아지고,
                      그 위의 흰 글씨는 오히려 더 안 읽힌다(대비 2.03 → 1.68).
                      반대로 16%만 어둡게 하면 색은 그대로 두고 밝기만 내려가
                      흰 글씨가 살아난다(대비 2.9). 회색이 섞이는 게 아니라
                      같은 색에 그늘이 지는 것이라 카드가 탁해지지도 않는다.
                      흰 테두리는 밝든 어둡든 윤곽을 남겨 '누를 수 있는 칸'으로 읽히게 한다. */}
                  <div
                    className={`flex gap-1.5 rounded-2xl p-1 ${
                      variant === "carousel"
                        ? "bg-black/[0.16] ring-1 ring-inset ring-white/40"
                        : "bg-slate-100"
                    }`}
                  >
                    <button
                      onClick={setAttend}
                      disabled={busy}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[14px] font-bold transition ${
                        iAmGoing
                          ? "bg-white text-emerald-600 shadow-sm"
                          : variant === "carousel"
                            ? "text-white"
                            : "text-slate-400"
                      }`}
                      // 선택 안 된 쪽만 그라데이션 위에 흰 글씨로 놓인다 → 미세 그림자
                      style={
                        variant === "carousel" && !iAmGoing ? { textShadow: ON_MESH_SHADOW } : undefined
                      }
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
                        !iAmGoing
                          ? "bg-white text-red-500 shadow-sm"
                          : variant === "carousel"
                            ? "text-white"
                            : "text-slate-400"
                      }`}
                      style={
                        variant === "carousel" && iAmGoing ? { textShadow: ON_MESH_SHADOW } : undefined
                      }
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
                      className={`grid h-9 w-9 place-items-center rounded-full border transition ${
                        variant === "carousel"
                          ? "border-white/45 text-white/90 hover:bg-white/15"
                          : "border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                      }`}
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
                      className={`grid h-9 w-9 place-items-center rounded-full border transition ${
                        variant === "carousel"
                          ? "border-white/45 text-white/90 hover:bg-white/15"
                          : "border-red-100 text-red-400 hover:bg-red-50 hover:text-red-500"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
                        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* 일정 페이지로 — 판 없이 글씨만.
                  참석/불참 토글만 판을 두르고 이건 글씨로 남긴다.
                  둘 다 판을 두르면 무게가 같아져서 어느 쪽이 '고르는 것'인지 안 읽힌다.
                  누르는 자리는 눌렀을 때(active) 옅게 밝아지는 것으로 알려 준다. */}
              {onOpenDetail && (
                <button
                  onClick={onOpenDetail}
                  className={`mt-2 w-full rounded-2xl py-2.5 text-[13px] font-semibold transition ${
                    variant === "carousel"
                      ? "text-white active:bg-white/15"
                      : "text-slate-400 hover:bg-slate-50"
                  }`}
                  style={variant === "carousel" ? { textShadow: ON_MESH_SHADOW } : undefined}
                >
                  일정에서 보기
                </button>
              )}
            </div>
          </div>
  );

  return (
    <div
      className={`relative overflow-hidden ${
        variant === "list"
          ? "rounded-2xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.03),0_6px_16px_-12px_rgba(16,24,40,0.1)]"
          : // 큰 라운드 + 옅은 그림자. 색이 이미 카드를 세워 주므로 그림자는 거들기만 한다.
            //
            // ⚠️ 필름 그레인(.mesh-grain)을 일시적으로 뺀 상태다.
            //    그레인은 mix-blend-mode: overlay로 얹히는데, 이 합성이 기기·화면
            //    배율마다 다르게 계산돼 폰에서 색이 탁해지는 원인으로 의심된다.
            //    먼저 그레인 없이 PC와 폰의 색이 같은지 확인한 뒤 다시 넣는다.
            //    (CSS는 app/globals.css에 그대로 남아 있다)
            "rounded-[28px] shadow-[0_4px_16px_-6px_rgba(16,24,40,0.16)]"
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
