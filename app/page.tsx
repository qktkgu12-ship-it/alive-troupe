"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import ScheduleCarousel from "@/components/ScheduleCarousel";
import { ProfileName } from "@/components/ProfileViewer";
import { MegaphoneIcon } from "@/components/Icons";
import {
  ARCHIVE_KIND_EMOJI,
  DEFAULT_RESOURCE_EMOJIS,
  FALLBACK_RESOURCE_EMOJI,
  boardCategoryLabel,
  resourceCategory,
  type ArchiveItem,
  type AudioTrack,
  type Post,
  type Production,
  type ScheduleEvent,
} from "@/lib/types";
import { chunk, relativeTime, toDateStr } from "@/lib/utils";

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
// 종료시간(없으면 시작시간, 둘 다 없으면 그날 자정)이 지났으면 '지난 일정'
function eventPassed(e: ScheduleEvent, nowMs: number) {
  const dt = parseDate(e.date);
  const end = e.endTime || e.startTime;
  if (end) {
    const [h, m] = end.split(":").map(Number);
    dt.setHours(h || 0, m || 0, 0, 0);
  } else {
    dt.setHours(23, 59, 59, 999);
  }
  return dt.getTime() < nowMs;
}

// 콘텐츠 카드 머리 — 제목과 '전체 보기' 화살표를 카드 안에 놓는다.
// 제목 + 리스트가 하나의 카드로 묶여야 같은 덩어리로 읽힌다.
// 일정 캐러셀의 '다가오는 일정'은 카드 밖(ScheduleCarousel)에 두어
// 일정 카드(주인공)와 콘텐츠 카드(보조)의 위계가 달라진다.
function CardHead({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="flex items-center justify-between px-4 pb-1 pt-4">
      <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">{title}</h2>
      <span className="grid h-6 w-6 place-items-center rounded-full text-slate-300 transition hover:text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </span>
    </Link>
  );
}

// 공지 띠 — 인사말 아래 한 줄. 누르면 게시판(공지가 맨 위에 고정돼 있다)으로 간다.
//
// 공지가 여럿이면 4초마다 조용히 다음 것으로 넘어간다.
// 글자가 옆으로 계속 흐르는 방식(마퀴)은 쓰지 않았다 — 움직이는 글자는 읽기 어렵고
// 멈출 수도 없어서, 놓치면 한 바퀴 돌 때까지 기다려야 한다.
// 하나뿐이면 아예 안 움직인다.
function NoticeBar({ notices }: { notices: Post[] }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (notices.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % notices.length), 4000);
    return () => clearInterval(t);
  }, [notices.length]);

  // 공지 개수가 줄어도 번호와 내용이 어긋나지 않게 항상 범위 안으로 접어 준다
  const idx = notices.length > 0 ? i % notices.length : 0;
  const cur = notices[idx];

  return (
    <Link
      href="/board"
      aria-label="공지 보기"
      className="content-card mt-3 flex items-center gap-3 px-4 py-3"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-accent">
        <MegaphoneIcon className="h-[17px] w-[17px]" />
        <span className="text-[13px] font-bold">공지</span>
      </span>
      {/* 세로 구분선 — 라벨과 내용의 역할을 가른다 */}
      <span className="h-4 w-px shrink-0 bg-slate-200" />
      {/* 공지가 없어도 칸은 남긴다 — 자리가 사라지면 화면이 매번 달라 보인다.
          key를 바꿔 다시 그리게 해서 넘어갈 때마다 페이드가 처음부터 돈다 */}
      <span
        key={cur?.id ?? "empty"}
        className={`animate-notice-in min-w-0 flex-1 truncate text-[14px] ${
          cur ? "font-medium text-slate-700" : "text-slate-400"
        }`}
      >
        {cur ? cur.title : "아직 등록된 공지가 없어요"}
      </span>
      {notices.length > 1 && (
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-300">
          {idx + 1}/{notices.length}
        </span>
      )}
    </Link>
  );
}

// 아카이브·자료실 카드 안의 한 줄 (이모지 · 제목 · 작성자 · 날짜)
// 이모지는 목록 페이지에서 그 자료에 붙는 것과 같은 걸 쓴다
function MediaRow({
  href,
  title,
  author,
  createdAt,
  emoji,
}: {
  href: string;
  title: string;
  author: string;
  createdAt: number;
  emoji: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-2 transition hover:bg-slate-50">
      {/* 아이콘 배경은 이모지를 얹을 자리만 잡아 주면 된다 —
          회색 면이 진하면 목록을 훑을 때 눈이 아이콘마다 걸린다 */}
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-lg leading-none">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        {/* 섹션 제목보다 한 단계 낮게 — 굵기와 명도를 같이 낮춰야 계층이 생긴다 */}
        <span className="block truncate text-[15px] font-medium text-slate-800">{title}</span>
        <span className="block truncate text-xs text-slate-400">
          {author || "－"} · {relativeTime(createdAt)}
        </span>
      </span>
    </Link>
  );
}

function HomeInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  // 자료실 이모지는 극단 설정을 먼저 따른다 (자료실 페이지와 동일)
  const catEmojis = settings.resourceCategoryEmojis ?? {};
  const resourceEmoji = (cat: string) =>
    catEmojis[cat] ?? DEFAULT_RESOURCE_EMOJIS[cat] ?? FALLBACK_RESOURCE_EMOJI;
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [notices, setNotices] = useState<Post[]>([]);
  const [recentArchives, setRecentArchives] = useState<ArchiveItem[]>([]);
  const [recentAudio, setRecentAudio] = useState<AudioTrack[]>([]);

  useEffect(() => {
    const today = toDateStr(new Date());
    const q = query(
      collection(db, "events"),
      where("date", ">=", today),
      orderBy("date", "asc")
    );
    const nowMs = Date.now();
    getDocs(q)
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
          .filter((e) => !eventPassed(e, nowMs)) // 시간이 지난 일정은 제외
          // 날짜순, 같은 날짜는 시작시간 빠른 순
          .sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")))
          .slice(0, 30);
        setUpcoming(list);
      })
      .catch(() => setUpcoming([]));

    // 전체글 (모든 게시판 최신글)
    getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(6)))
      .then((snap) => setRecentPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))))
      .catch(() => setRecentPosts([]));

    // 공지 — 상단 띠에 쓴다.
    // where 하나뿐이라 복합 색인이 필요 없다 (게시판 페이지와 같은 방식).
    // 최신 3개만 — 오래된 공지까지 계속 돌면 그냥 소음이 된다.
    getDocs(query(collection(db, "posts"), where("isNotice", "==", true)))
      .then((snap) =>
        setNotices(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .slice(0, 3)
        )
      )
      .catch(() => setNotices([]));
  }, []);

  // 아카이브 · 자료실 최신 3개
  //
  // 보안 규칙이 '참여 중인 작품의 자료'만 읽게 막아 두어서, 전체를 훑는 질의는
  // 통째로 거부된다. 먼저 내 작품 목록을 받아 그 안에서만 찾는다.
  useEffect(() => {
    if (!user) return;
    let alive = true;

    (async () => {
      try {
        const pq = isAdmin
          ? query(collection(db, "productions"), orderBy("order", "asc"))
          : query(collection(db, "productions"), where("participants", "array-contains", user.uid));
        const psnap = await getDocs(pq);
        const prodIds = psnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) })).map((p) => p.id);

        // 최신 3개만 쓰므로 넉넉히 받아 등록순으로 자른다
        const pick = <T extends { createdAt: number }>(rows: T[]) =>
          rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 3);

        const fetchScoped = async <T,>(name: "archives" | "audio"): Promise<T[]> => {
          if (isAdmin) {
            const snap = await getDocs(query(collection(db, name), orderBy("createdAt", "desc"), limit(3)));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
          }
          if (prodIds.length === 0) return [];
          // Firestore 'in'은 최대 30개 → 나눠 던지고 합친다
          const snaps = await Promise.all(
            chunk(prodIds, 30).map((ids) => getDocs(query(collection(db, name), where("productionId", "in", ids))))
          );
          return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
        };

        const [arch, aud] = await Promise.all([
          fetchScoped<ArchiveItem>("archives"),
          fetchScoped<AudioTrack>("audio"),
        ]);
        if (!alive) return;
        setRecentArchives(pick(arch));
        setRecentAudio(pick(aud));
      } catch {
        if (!alive) return;
        setRecentArchives([]);
        setRecentAudio([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user, isAdmin]);

  // 내 팀 일정만 (공통 + 내 팀). 팀 미지정이거나 관리자면 전체 (네이버 예약 일정도 포함)
  const myTeam = role === "admin" ? "" : (profile?.team ?? "");
  const myEvents = upcoming.filter((e) => !myTeam || !e.team || e.team === myTeam);
  const shownEvents = myEvents.slice(0, 5);

  return (
    // 상단바와 인사말 사이는 조금 좁게 — 인사말이 헤더에 이어지는 느낌으로.
    // 카드 사이(space-y)는 넓히고 카드 안쪽 padding은 줄였다 —
    // 여백이 '박스 안'이 아니라 '정보 사이'에 있어야 숨통이 트인다.
    <div className="-mt-3 space-y-6">
      {/* 인사말 + 일정 — 한 덩어리.
          예전엔 '인사말 / 캐치프라이즈 / 다가오는 일정' 세 줄이 서로 비슷한 간격으로
          떨어져 있어 셋 다 동급으로 읽혔고, 26px와 22px 큰 제목 둘이 주인공 자리를
          다퉜다. 큰 제목을 인사말 하나로 합치고, 둘째 줄이 섹션 제목을 겸하게 했다.
          날짜 줄은 없다 (폰 상단바와 겹친다). */}
      <section>
        <h1 className="pt-1 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        {/* 캐치프라이즈 — 예전엔 font-mono + 대문자 + 자간 0.2em이었는데,
            고정폭 서체는 이미 글자 사이가 넓어서 자간까지 더하면 흩어져 보였다.
            앱 본문 서체(Pretendard)로 바꾸고 자간을 0.1em으로 조여 균형을 맞췄다.
            제목과의 간격도 살짝 붙여 두 줄이 한 덩어리로 읽히게 한다. */}
        <p className="mt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
          Today, Here, Right now!
        </p>
        {/* 공지가 없어도 칸은 유지한다 (NoticeBar 안에서 빈 문구를 보여 준다) */}
        <NoticeBar notices={notices} />
      </section>

      {/* 다가오는 확정 일정 — 카드 캐러셀 */}
      <section>
        <ScheduleCarousel events={shownEvents} teams={teams} />
      </section>

      {/* 아카이브 — 최신 3개. 제목 + 리스트를 하나의 카드로 묶는다. */}
      <section>
        <div className="content-card overflow-hidden">
          <CardHead title="아카이브" href="/archive" label="아카이브 전체 보기" />
          {recentArchives.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">아직 등록된 자료가 없습니다.</p>
          ) : (
            <div className="pb-2">
              {recentArchives.map((a) => (
                <MediaRow
                  key={a.id}
                  href={`/archive?item=${a.id}`}
                  title={a.title}
                  author={a.createdByName}
                  createdAt={a.createdAt}
                  emoji={ARCHIVE_KIND_EMOJI[a.kind] ?? ARCHIVE_KIND_EMOJI.etc}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 자료실 — 최신 3개. 제목 + 리스트를 하나의 카드로 묶는다. */}
      <section>
        <div className="content-card overflow-hidden">
          <CardHead title="자료실" href="/audio" label="자료실 전체 보기" />
          {recentAudio.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">아직 등록된 자료가 없습니다.</p>
          ) : (
            <div className="pb-2">
              {recentAudio.map((t) => (
                <MediaRow
                  key={t.id}
                  href={`/audio?item=${t.id}&pid=${t.productionId}`}
                  title={t.title || t.song || "제목 없음"}
                  author={t.addedByName}
                  createdAt={t.createdAt}
                  emoji={resourceEmoji(resourceCategory(t))}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 전체글 (모든 게시판 최신글). 제목 + 리스트를 하나의 카드로 묶는다. */}
      <section>
        <div className="content-card overflow-hidden">
          <CardHead title="전체글" href="/board" label="게시판 전체 보기" />
          {recentPosts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">아직 작성된 글이 없습니다.</p>
          ) : (
            <ul className="pb-2">
              {recentPosts.map((p) => (
                <li key={p.id}>
                  <Link href={`/board/${p.id}`} className="flex items-center gap-2 px-4 py-2 transition hover:bg-slate-50">
                    {p.isNotice ? (
                      <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">공지</span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {boardCategoryLabel(p.board)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-slate-800">{p.title}</span>
                    {(p.commentCount ?? 0) > 0 && (
                      <span className="shrink-0 text-xs font-semibold text-accent">[{p.commentCount}]</span>
                    )}
                    <span className="hidden shrink-0 text-xs text-slate-400 sm:inline"><ProfileName uid={p.authorUid} name={p.authorName} /></span>
                    <span className="shrink-0 text-xs text-slate-300">{relativeTime(p.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {role === "admin" && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">관리</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin" className="btn-accent">관리 페이지</Link>
          </div>
        </section>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Guard>
      <HomeInner />
    </Guard>
  );
}
