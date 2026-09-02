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

// 카드 머리 — 제목과 '전체 보기' 화살표를 카드 안에 넣는다
function CardHead({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex items-center justify-between px-4 pb-1 pt-4 transition hover:bg-slate-50"
    >
      <h2 className="text-[17px] font-bold text-slate-900">{title}</h2>
      <span className="grid h-7 w-7 place-items-center rounded-full text-slate-300 transition hover:text-accent">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </span>
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
    <Link href={href} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-xl leading-none">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
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
  const shownEvents = upcoming
    .filter((e) => !myTeam || !e.team || e.team === myTeam)
    .slice(0, 5);

  return (
    // 상단바와 인사말 사이는 조금 좁게 — 인사말이 헤더에 이어지는 느낌으로
    <div className="-mt-3 space-y-4">
      {/* 인사 — 담백하게 */}
      <header className="pt-1 pb-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">Today, Here, Right now!</p>
      </header>

      {/* 다가오는 확정 일정 — 컬러 카드 캐러셀 */}
      <section>
        <ScheduleCarousel events={shownEvents} teams={teams} />
      </section>

      {/* 아카이브 — 최신 3개 */}
      <section>
        <div className="card overflow-hidden !p-0">
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

      {/* 자료실 — 최신 3개 */}
      <section>
        <div className="card overflow-hidden !p-0">
          <CardHead title="자료실" href="/audio" label="자료실 전체 보기" />
          {recentAudio.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">아직 등록된 자료가 없습니다.</p>
          ) : (
            <div className="pb-2">
              {recentAudio.map((t) => (
                <MediaRow
                  key={t.id}
                  // 자료실은 작품별로 나뉘어 있어 어느 탭인지도 함께 알려 준다
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

      {/* 전체글 (모든 게시판 최신글) */}
      <section>
        <div className="card overflow-hidden !p-0">
          <CardHead title="전체글" href="/board" label="게시판 전체 보기" />
          {recentPosts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">아직 작성된 글이 없습니다.</p>
          ) : (
            <ul className="pb-2">
              {recentPosts.map((p) => (
                <li key={p.id}>
                  <Link href={`/board/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 transition hover:bg-slate-50">
                    {p.isNotice ? (
                      <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-fg">공지</span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {boardCategoryLabel(p.board)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.title}</span>
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
