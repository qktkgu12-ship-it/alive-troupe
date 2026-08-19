"use client";

// /lab — 홈 화면과 똑같이 생긴 '유령 페이지'.
//
// 실험 중인 UI를 실제 앱 안에서 확인하려고 만들었다. 로그인·PWA·푸시 알림·
// 실제 데이터가 홈과 완전히 같은 조건이라, 정적 테스트 페이지에서는 확인할 수
// 없던 것들(설치된 앱에서의 동작, 알림 등)을 여기서 그대로 볼 수 있다.
//
// 홈(app/page.tsx)과 다른 곳은 딱 하나 — 일정 캐러셀이 실험판이다.
// 실험이 끝나면 홈의 ScheduleCarousel을 교체하고 이 페이지는 지운다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import Guard from "@/components/Guard";
import ScheduleCarouselV2 from "@/components/ScheduleCarouselV2";
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
import { chunk, relativeTime, toDateStr, WEEKDAYS_KO } from "@/lib/utils";

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
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

function LabInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";
  const { settings } = useTheme();
  const teams = settings.teams ?? [];
  const catEmojis = settings.resourceCategoryEmojis ?? {};
  const resourceEmoji = (cat: string) =>
    catEmojis[cat] ?? DEFAULT_RESOURCE_EMOJIS[cat] ?? FALLBACK_RESOURCE_EMOJI;
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS_KO[now.getDay()]})`;
  const [upcoming, setUpcoming] = useState<ScheduleEvent[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [recentArchives, setRecentArchives] = useState<ArchiveItem[]>([]);
  const [recentAudio, setRecentAudio] = useState<AudioTrack[]>([]);

  useEffect(() => {
    const today = toDateStr(new Date());
    const q = query(collection(db, "events"), where("date", ">=", today), orderBy("date", "asc"));
    const nowMs = Date.now();
    getDocs(q)
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) }))
          .filter((e) => !eventPassed(e, nowMs))
          .sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")))
          .slice(0, 30);
        setUpcoming(list);
      })
      .catch(() => setUpcoming([]));

    getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(6)))
      .then((snap) => setRecentPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }))))
      .catch(() => setRecentPosts([]));
  }, []);

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

        const pick = <T extends { createdAt: number }>(rows: T[]) =>
          rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 3);

        const fetchScoped = async <T,>(name: "archives" | "audio"): Promise<T[]> => {
          if (isAdmin) {
            const snap = await getDocs(query(collection(db, name), orderBy("createdAt", "desc"), limit(3)));
            return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
          }
          if (prodIds.length === 0) return [];
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

  const myTeam = role === "admin" ? "" : (profile?.team ?? "");
  const shownEvents = upcoming.filter((e) => !myTeam || !e.team || e.team === myTeam).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* 여기가 실험실이라는 표시 — 홈과 헷갈리지 않게 */}
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2">
        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white">LAB</span>
        <p className="min-w-0 flex-1 text-xs text-slate-500">
          홈과 같지만 <b className="font-semibold text-slate-700">일정 카드만 실험판</b>입니다.
        </p>
        <Link href="/" className="shrink-0 text-xs font-semibold text-accent">홈으로</Link>
      </div>

      <header className="pt-1 pb-1">
        <p className="text-xs font-medium text-slate-400">{todayLabel}</p>
        <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
          안녕하세요, {profile?.name || profile?.displayName}님 <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">Today, Here, Right now!</p>
      </header>

      {/* ▼ 홈과 다른 유일한 곳 */}
      <section>
        <ScheduleCarouselV2 events={shownEvents} teams={teams} />
      </section>

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
    </div>
  );
}

export default function LabPage() {
  return (
    <Guard>
      <LabInner />
    </Guard>
  );
}
