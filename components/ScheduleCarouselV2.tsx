"use client";

// 홈 캐러셀 (실험판) — 카드를 펼쳐 참여 인원을 보고 참석 여부를 정한다.
//
// 지금 쓰는 ScheduleCarousel과 다른 점:
//   · 우상단 버튼으로 카드가 펼쳐진다 (카드 본문 탭은 지금처럼 일정 페이지로)
//   · 펼치면 폭이 넓어져 옆 카드가 화면 밖으로 밀려난다
//   · 펼친 안에 참여 인원이 명단으로 깔린다 (참석 / 불참 + 사유)
//   · 참석이 기본. 불참을 누르면 사유 바텀시트가 올라온다
//
// 참여 인원은 지금 데이터 구조를 그대로 따른다:
//   팀 소속 = 참여, 못 오는 사람만 events/{id}/absences/{uid}에 불참을 남긴다.
//   (일정 등록 때 인원을 직접 고르는 기능은 다음 작업)

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import BottomSheet from "@/components/BottomSheet";
import { ProfileAvatar } from "@/components/ProfileViewer";
import { PinIcon } from "@/components/Icons";
import { WEEKDAYS_KO } from "@/lib/utils";
import type { Absence, PublicProfile, ScheduleEvent } from "@/lib/types";

const SLIDE = "420ms cubic-bezier(0.34, 1.36, 0.4, 1)";
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const COLORS = {
  all: "rgb(var(--accent))",
  teamA: "#19BDA4",
  teamB: "#7A2FF2",
  naver: "#2F9E44",
} as const;

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

function duration(start?: string, end?: string) {
  if (!start || !end) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let min = eh * 60 + em - (sh * 60 + sm);
  if (min <= 0) return "";
  const h = Math.floor(min / 60);
  min = min % 60;
  return h ? (min ? `${h}시간 ${min}분` : `${h}시간`) : `${min}분`;
}

type Member = { uid: string; name: string; avatar?: string; team?: string };

const REASONS = ["개인 일정", "학교·직장", "건강", "이동이 어려워요", "기타"];

export default function ScheduleCarouselV2({
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

  const [members, setMembers] = useState<Member[]>([]);
  // 일정별 불참 명단. 펼칠 때 처음 한 번만 읽는다.
  const [absences, setAbsences] = useState<Record<string, Absence[]>>({});

  // 사유 바텀시트
  const [sheetFor, setSheetFor] = useState<ScheduleEvent | null>(null);
  const [pickedReason, setPickedReason] = useState("");
  const [etcReason, setEtcReason] = useState("");
  const [busy, setBusy] = useState(false);

  const count = events.length;

  useEffect(() => {
    let alive = true;
    getDocs(collection(db, "publicProfiles"))
      .then((snap) => {
        if (!alive) return;
        const list = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }));
        setMembers(list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko")));
      })
      .catch(() => setMembers([]));
    return () => {
      alive = false;
    };
  }, []);

  const loadAbsences = useCallback(async (eventId: string) => {
    try {
      const snap = await getDocs(collection(db, "events", eventId, "absences"));
      setAbsences((m) => ({ ...m, [eventId]: snap.docs.map((d) => d.data() as Absence) }));
    } catch {
      setAbsences((m) => ({ ...m, [eventId]: [] }));
    }
  }, []);

  // 보고 있는 카드 = 카드 한가운데가 화면 한가운데에 가장 가까운 것
  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const kids = Array.from(el.children).slice(0, count) as HTMLElement[];
    if (kids.length === 0) return;
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
    return <div className="card py-10 text-center text-sm text-slate-400">예정된 확정 일정이 없습니다.</div>;
  }

  /** 그 일정에 참여하는 단원 (팀 소속 = 참여) */
  function participantsOf(e: ScheduleEvent): Member[] {
    if (e.source === "naver") return [];
    if (!e.team) return members;
    return members.filter((m) => m.team === e.team);
  }

  function toggleOpen(e: ScheduleEvent) {
    const opening = openId !== e.id;
    setOpenId(opening ? e.id : null);
    if (opening) {
      if (!absences[e.id]) void loadAbsences(e.id);
      const kid = trackRef.current?.children[events.indexOf(e)] as HTMLElement | undefined;
      requestAnimationFrame(() => kid?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }));
    }
  }

  async function markGoing(e: ScheduleEvent) {
    if (!user) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "events", e.id, "absences", user.uid));
      await loadAbsences(e.id);
    } finally {
      setBusy(false);
    }
  }

  // BottomSheet는 onConfirm의 Promise를 기다리지 않으므로(반환값을 그 자리에서
  // false와 비교한다) 검사는 동기로 끝내고, 저장만 뒤에서 돌린다.
  function submitAbsence(): boolean | void {
    if (!user || !sheetFor) return false;
    const reason = etcReason.trim() || pickedReason;
    if (!reason) {
      alert("사유를 골라 주세요.");
      return false;
    }
    const target = sheetFor;
    setBusy(true);
    void (async () => {
      try {
        await setDoc(doc(db, "events", target.id, "absences", user.uid), {
          uid: user.uid,
          name: profile?.name || profile?.displayName || "",
          reason,
          createdAt: Date.now(),
        });
        await loadAbsences(target.id);
      } finally {
        setBusy(false);
        setPickedReason("");
        setEtcReason("");
      }
    })();
  }

  const dotColor = eventColor(events[Math.min(idx, events.length - 1)], teams);
  const pad = "clamp(15px,7.1cqw,24px)";

  return (
    <div>
      <div
        ref={trackRef}
        className={`no-scrollbar -mx-4 flex items-start snap-x snap-mandatory scroll-px-4 gap-3 scroll-smooth px-4 ${
          openId ? "overflow-x-hidden" : "overflow-x-auto"
        }`}
      >
        {events.map((e, i) => {
          const color = eventColor(e, teams);
          const dt = parseDate(e.date);
          const open = openId === e.id;
          const edge = i === 0 || i === events.length - 1;
          const href = `/schedule?tab=events&event=${e.id}&date=${e.date}`;

          const parts = participantsOf(e);
          const outs = absences[e.id] ?? [];
          const outSet = new Set(outs.map((a) => a.uid));
          const going = parts.filter((m) => !outSet.has(m.uid));
          const iAmIn = !!user && parts.some((m) => m.uid === user.uid);
          const myAbsence = outs.find((a) => a.uid === user?.uid);

          return (
            <div
              key={e.id}
              style={{
                backgroundColor: color,
                transition: `width 420ms ${EASE}, max-width 420ms ${EASE}, opacity 220ms ease`,
              }}
              className={`cq relative shrink-0 rounded-[26px] text-white shadow-[0_10px_30px_-14px_rgba(16,24,40,0.45)] ${
                open ? "w-full max-w-none" : "w-[80%] max-w-[330px]"
              } ${openId && !open ? "invisible opacity-0" : ""} ${edge ? "snap-start" : "snap-center"}`}
            >
              <div className="relative" style={{ padding: pad }}>
                {/* 펼치기 — 접혔을 땐 흰 버튼, 펼치면 반투명 */}
                <button
                  type="button"
                  onClick={() => toggleOpen(e)}
                  aria-expanded={open}
                  aria-label={open ? "상세 접기" : "상세 보기"}
                  style={{
                    top: "clamp(13px,6.2cqw,21px)",
                    right: "clamp(13px,6.2cqw,21px)",
                    width: "clamp(27px,11.4cqw,36px)",
                    height: "clamp(27px,11.4cqw,36px)",
                    transition: `transform 420ms ${EASE}, background 180ms ease, color 180ms ease`,
                  }}
                  className={`absolute z-10 grid place-items-center rounded-full ${
                    open ? "rotate-180 bg-white/20 text-white" : "bg-white text-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.16)]"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-[56%] w-[56%]">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {/* 머리 — 본문을 누르면 지금처럼 일정 페이지로 */}
                <div
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") router.push(href);
                  }}
                  style={{
                    minHeight: open ? 0 : "52.5cqw",
                    transition: `min-height 420ms ${EASE}`,
                  }}
                  className="flex cursor-pointer flex-col"
                >
                  <div className="flex items-center gap-2 pr-[clamp(34px,13cqw,46px)]">
                    <p className="m-0 text-[clamp(11.5px,5.3cqw,16px)] font-medium text-white/[.78]">
                      {dt.getMonth() + 1}월 {dt.getDate()}일 ({WEEKDAYS_KO[dt.getDay()]})
                    </p>
                    {open && (
                      <span className="rounded-full bg-white/20 px-[0.8em] py-[0.24em] text-[clamp(10.5px,4.4cqw,13.5px)] font-extrabold backdrop-blur-sm">
                        {ddayLabel(e.date)}
                      </span>
                    )}
                  </div>

                  {!open && (
                    <p className="mt-[0.12em] text-[clamp(13px,6cqw,18px)] font-bold tabular-nums tracking-[-0.02em]">
                      {e.startTime ? `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}` : "시간 미정"}
                    </p>
                  )}

                  <h3 className="mt-[clamp(7px,3.2cqw,11px)] line-clamp-2 text-[clamp(17.5px,8.2cqw,28px)] font-extrabold leading-[1.14] tracking-[-0.03em]">
                    {e.title}
                  </h3>

                  {!open && (
                    <>
                      {/* 얼굴들 — 흰 알약 안에 */}
                      <div className="mt-auto flex pt-[0.6em]">
                        {e.source === "naver" ? (
                          <span className="inline-flex items-center rounded-full bg-white px-[clamp(10px,4.4cqw,14px)] py-[clamp(4px,1.9cqw,7px)] text-[clamp(11px,4.7cqw,14px)] font-bold text-slate-700 shadow-[0_2px_8px_-2px_rgba(16,24,40,0.28)]">
                            네이버 예약
                          </span>
                        ) : parts.length === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-white px-[clamp(10px,4.4cqw,14px)] py-[clamp(4px,1.9cqw,7px)] text-[clamp(11px,4.7cqw,14px)] font-bold text-slate-700 shadow-[0_2px_8px_-2px_rgba(16,24,40,0.28)]">
                            {e.team || "단원 전체"}
                          </span>
                        ) : (
                          <AvatarPill members={parts} />
                        )}
                      </div>

                      {/* 맨 아래 — 장소(좌) · D-day(우) */}
                      <div className="mt-[0.5em] flex items-center gap-2.5">
                        <p className="m-0 flex min-w-0 flex-1 items-center gap-[0.34em] text-[clamp(11.5px,5.2cqw,15.5px)] font-medium text-white/80">
                          {e.location ? (
                            <>
                              <PinIcon className="h-[1.12em] w-[1.12em] shrink-0 opacity-70" />
                              <span className="truncate">{e.location}</span>
                            </>
                          ) : (
                            <span className="text-white/60">장소 미정</span>
                          )}
                        </p>
                        <span className="shrink-0 rounded-full bg-white/20 px-[0.8em] py-[0.24em] text-[clamp(10.5px,4.9cqw,15px)] font-extrabold backdrop-blur-sm">
                          {ddayLabel(e.date)}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 펼쳐지는 상세 */}
                <div
                  className="grid"
                  style={{
                    gridTemplateRows: open ? "1fr" : "0fr",
                    transition: `grid-template-rows 420ms ${EASE}`,
                  }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-[clamp(11px,4.8cqw,16px)] rounded-[18px] bg-white p-[clamp(13px,5.6cqw,18px)] text-slate-900 shadow-[0_6px_20px_-10px_rgba(16,24,40,0.3)]">
                      <DetailRow k="시간" v={
                        e.startTime
                          ? `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}`
                          : "미정"
                      } sub={duration(e.startTime, e.endTime)} num />
                      <DetailRow k="장소" v={e.location || "미정"} />
                      {e.memo && <DetailRow k="메모" v={e.memo} />}

                      {e.source !== "naver" && (
                        <Roster going={going} outs={outs} myUid={user?.uid} loaded={!!absences[e.id]} />
                      )}
                    </div>

                    {/* 참석 여부 — 팀원(지정 인원)이면 참석이 기본 */}
                    {e.source !== "naver" && iAmIn && (
                      <div className="flex items-center gap-2.5 px-0.5 pt-[clamp(11px,4.6cqw,15px)]">
                        <p className="m-0 flex-1 text-[clamp(11.5px,5.2cqw,14.5px)] font-bold text-white">
                          {myAbsence ? "불참으로 등록됐어요" : "참석으로 등록됐어요"}
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setSheetFor(e);
                            setPickedReason("");
                            setEtcReason("");
                          }}
                          className={`shrink-0 rounded-full border-[1.5px] px-[1.15em] py-[0.5em] text-[clamp(11.5px,5.2cqw,14px)] font-extrabold transition active:scale-95 disabled:opacity-50 ${
                            myAbsence ? "border-white bg-white text-slate-900" : "border-white/55 text-white hover:bg-white/15"
                          }`}
                        >
                          불참
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void markGoing(e)}
                          className={`shrink-0 rounded-full border-[1.5px] px-[1.15em] py-[0.5em] text-[clamp(11.5px,5.2cqw,14px)] font-extrabold transition active:scale-95 disabled:opacity-50 ${
                            !myAbsence ? "border-white bg-white text-slate-900" : "border-white/55 text-white hover:bg-white/15"
                          }`}
                        >
                          참석
                        </button>
                      </div>
                    )}

                    {e.source === "naver" && (
                      <p className="px-0.5 pt-[clamp(10px,4.4cqw,14px)] text-[clamp(11px,5cqw,13.5px)] font-semibold leading-snug text-white/80">
                        외부에서 가져온 예약이라 참여 신청은 없습니다.
                      </p>
                    )}
                    {e.source !== "naver" && !iAmIn && (
                      <p className="px-0.5 pt-[clamp(10px,4.4cqw,14px)] text-[clamp(11px,5cqw,13.5px)] font-semibold leading-snug text-white/80">
                        내 팀 일정이 아니라 참석 여부를 고를 수 없어요.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {!openId && (
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
        )}
      </div>

      {/* 점 */}
      {!openId && (
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
      )}

      {/* 불참 사유 */}
      <BottomSheet
        open={!!sheetFor}
        title="이 날 못가요"
        onClose={() => setSheetFor(null)}
        onConfirm={submitAbsence}
      >
        {sheetFor && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              {sheetFor.title} · {sheetFor.date}
            </p>
            <div>
              <p className="mb-2 text-xs font-bold text-slate-500">사유를 알려 주세요</p>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setPickedReason((v) => (v === r ? "" : r))}
                    className={`rounded-full border-[1.5px] px-3.5 py-2 text-sm font-semibold transition ${
                      pickedReason === r
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={etcReason}
              onChange={(ev) => setEtcReason(ev.target.value)}
              placeholder="직접 적기 (선택)"
              className="input"
            />
            <p className="text-xs text-slate-400">등록하면 명단의 내 이름 옆에 사유가 표시됩니다.</p>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* ── 카드 위 흰 알약에 담긴 얼굴들 (최대 4명 + 나머지는 +N) ── */
function AvatarPill({ members }: { members: Member[] }) {
  const show = members.slice(0, 4);
  const rest = members.length - show.length;
  const size = "clamp(22px,9.6cqw,31px)";
  return (
    <span
      className="inline-flex items-center rounded-full bg-white shadow-[0_2px_8px_-2px_rgba(16,24,40,0.28)]"
      style={{ padding: "clamp(1px,.45cqw,1.5px) clamp(2.5px,1.1cqw,4px)" }}
    >
      {show.map((m, i) => (
        <span
          key={m.uid}
          className="shrink-0 rounded-full border-2 border-white"
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : `calc(${size} * -0.28)` }}
        >
          <Face name={m.name} avatar={m.avatar} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="grid shrink-0 place-items-center rounded-full border-2 border-white bg-slate-100 font-extrabold text-slate-600"
          style={{
            width: size,
            height: size,
            marginLeft: `calc(${size} * -0.28)`,
            fontSize: "clamp(9.5px,4.1cqw,13px)",
          }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

function Face({ name, avatar }: { name?: string; avatar?: string }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" loading="lazy" className="h-full w-full rounded-full object-cover" />;
  }
  const ch = (name || "?").charAt(0);
  const TINT = ["#c9bcf6", "#f7de8d", "#f4c2ba", "#b9e2c8", "#fac8de", "#bed8f8", "#e8cdab", "#c5e0e8"];
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + (name || "").charCodeAt(i)) >>> 0;
  return (
    <span
      className="grid h-full w-full place-items-center rounded-full font-bold text-slate-700"
      style={{ background: TINT[h % TINT.length], fontSize: "clamp(9.5px,4.1cqw,13px)" }}
    >
      {ch}
    </span>
  );
}

/* ── 상세 한 줄 ── */
function DetailRow({ k, v, sub, num }: { k: string; v: string; sub?: string; num?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 border-t border-slate-100 py-[7px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[11.5px] font-semibold text-slate-400">{k}</p>
        <p className={`m-0 mt-px break-words text-sm font-semibold leading-snug text-slate-900 ${num ? "tabular-nums" : ""}`}>
          {v}
          {sub && <span className="font-medium text-slate-400"> · {sub}</span>}
        </p>
      </div>
    </div>
  );
}

/* ── 참여 인원 명단 — 크기는 일정방 만들기의 개별 선택 리스트와 동일 ── */
function Roster({
  going,
  outs,
  myUid,
  loaded,
}: {
  going: Member[];
  outs: Absence[];
  myUid?: string;
  loaded: boolean;
}) {
  if (!loaded) {
    return <p className="border-t border-slate-100 pt-3 text-center text-xs text-slate-400">참여 인원 불러오는 중…</p>;
  }
  if (going.length === 0 && outs.length === 0) {
    return <p className="border-t border-slate-100 pt-3 text-center text-xs text-slate-400">참여 인원이 없습니다.</p>;
  }
  return (
    <div className="mt-3 border-t border-slate-100 pt-1">
      {going.length > 0 && (
        <div>
          <p className="mb-2 mt-2 text-[13px] font-semibold text-slate-400">
            참석 <b className="font-bold text-slate-900">{going.length}명</b>
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {going.map((m) => (
              <div key={m.uid} className="flex min-w-0 items-center gap-2.5 py-0.5">
                <ProfileAvatar uid={m.uid} name={m.name} avatar={m.avatar} className="h-7 w-7 text-xs" />
                <span className="min-w-0 truncate text-sm text-slate-700">
                  {m.name}
                  {m.uid === myUid && (
                    <span className="ml-1.5 rounded bg-slate-900 px-1 py-px align-[1.5px] text-[10px] font-extrabold text-white">나</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {outs.length > 0 && (
        <div className={going.length > 0 ? "mt-3 border-t border-slate-100 pt-3" : ""}>
          <p className="mb-2 mt-2 text-[13px] font-semibold text-slate-400">
            불참 <b className="font-bold text-slate-900">{outs.length}명</b>
          </p>
          <div className="space-y-1.5">
            {outs.map((a) => (
              <div key={a.uid} className="flex min-w-0 items-center gap-2.5 py-0.5">
                <span className="opacity-55 grayscale">
                  <ProfileAvatar uid={a.uid} name={a.name} className="h-7 w-7 text-xs" />
                </span>
                <span className="shrink-0 text-sm text-slate-500">
                  {a.name || "이름 없음"}
                  {a.uid === myUid && (
                    <span className="ml-1.5 rounded bg-slate-900 px-1 py-px align-[1.5px] text-[10px] font-extrabold text-white">나</span>
                  )}
                </span>
                {a.reason && <span className="min-w-0 truncate text-xs text-slate-400">{a.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
