// 홈페이지 전체 검색
// Firestore는 전문(full-text) 검색이 없어서, 접근 권한에 맞는 문서만 불러와 브라우저에서 걸러냄.
// (단원 규모가 작아 문서 수가 적고, 검색을 실제로 할 때만 불러오므로 부담이 적음)

import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { chunk } from "@/lib/utils";
import type { ArchiveItem, AudioTrack, Post, Production, ScheduleEvent } from "@/lib/types";

export type SearchKind = "board" | "archive" | "audio" | "event";

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  board: "게시판",
  archive: "아카이브",
  audio: "자료실",
  event: "일정",
};

// 칩 순서 (전체는 UI에서 별도 처리)
export const SEARCH_KIND_ORDER: SearchKind[] = ["board", "archive", "audio", "event"];

export interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  sub?: string; // 부가 설명(본문 일부·메모 등)
  meta?: string; // 작성자·날짜 등
  href: string;
  time: number; // 정렬용
}

// 검색어 정규화: 공백 제거 + 소문자 (한글은 그대로, 대소문자만 통일)
function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "");
}

// 여러 필드 중 하나라도 검색어를 포함하면 매치
function hit(q: string, ...fields: (string | undefined | null)[]): boolean {
  const nq = norm(q);
  if (!nq) return false;
  return fields.some((f) => f && norm(f).includes(nq));
}

// HTML 본문에서 태그를 걷어내 검색·미리보기용 텍스트로
function stripHtml(html: string): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function excerpt(text: string, q: string, len = 60): string {
  const t = stripHtml(text);
  const i = norm(t).indexOf(norm(q));
  if (i < 0) return t.slice(0, len);
  // 매치 위치 근처를 보여줌 (정규화 인덱스라 근사치)
  const start = Math.max(0, i - 15);
  return (start > 0 ? "…" : "") + t.slice(start, start + len);
}

function dateOf(ds: string): number {
  const t = new Date(ds + "T00:00:00").getTime();
  return isNaN(t) ? 0 : t;
}

// ---------- 검색 대상 묶음(코퍼스) 캐시 ----------
// 검색어를 바꿀 때마다 컬렉션 전체를 다시 읽으면 낭비가 크다.
// (예전엔 'ㄱ' 치고 'ㄴ' 치면 posts·events·archives·audio를 매번 처음부터 다시 읽었음)
// 한 번 읽어 잠깐 들고 있다가, 같은 사람이 이어서 검색하면 메모리에서 바로 거른다.
interface Corpus {
  posts: (Post & { _body: string })[]; // _body = HTML 걷어낸 본문(매 검색마다 파싱하지 않도록 미리 계산)
  events: ScheduleEvent[];
  archives: ArchiveItem[];
  audios: AudioTrack[];
  prodName: Map<string, string>;
}

const CORPUS_TTL = 120_000; // 2분 — 이 안에 다시 검색하면 네트워크 없이 즉시
let corpusCache: { key: string; at: number; data: Corpus } | null = null;
// 아직 받는 중인 조회 — 검색을 연달아 하면 같은 조회가 두 번 나가지 않게 공유
let inFlight: { key: string; promise: Promise<Corpus> } | null = null;

// 캐시를 비운 시점을 세대로 기록. 비우기 직전에 시작된 조회가 뒤늦게 끝나면서
// (그 글이 빠진) 옛 데이터를 다시 캐시에 심는 걸 막는다.
let generation = 0;

/** 글·자료를 새로 등록한 뒤 검색 결과에 바로 반영하고 싶을 때 호출 */
export function clearSearchCache() {
  corpusCache = null;
  inFlight = null;
  generation++;
}

function loadCorpus(uid: string, isAdmin: boolean): Promise<Corpus> {
  // 사용자가 바뀌면 접근 범위가 달라지므로 캐시 키에 포함
  const key = `${uid}:${isAdmin}`;
  if (corpusCache && corpusCache.key === key && Date.now() - corpusCache.at < CORPUS_TTL) {
    return Promise.resolve(corpusCache.data);
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;

  const promise = fetchCorpus(uid, isAdmin, key).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}

async function fetchCorpus(uid: string, isAdmin: boolean, key: string): Promise<Corpus> {
  const gen = generation;

  // 내가 접근 가능한 작품 목록 (아카이브·자료실 범위 결정)
  const prodQ = isAdmin
    ? query(collection(db, "productions"), orderBy("order", "asc"))
    : query(collection(db, "productions"), where("participants", "array-contains", uid || "__none__"));

  const [postSnap, eventSnap, prodSnap] = await Promise.all([
    getDocs(collection(db, "posts")),
    getDocs(collection(db, "events")),
    getDocs(prodQ),
  ]);

  const prodName = new Map<string, string>();
  prodSnap.forEach((d) => prodName.set(d.id, (d.data() as Production).name ?? ""));
  const myProdIds = [...prodName.keys()];

  // 아카이브: 관리자는 전체, 단원은 참여 작품만 ('in'은 최대 30개라 나눠 조회)
  const archivePromise: Promise<ArchiveItem[]> = (async () => {
    if (isAdmin) {
      const snap = await getDocs(collection(db, "archives"));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) }));
    }
    if (myProdIds.length === 0) return [];
    const parts = chunk(myProdIds, 30);
    const snaps = await Promise.all(
      parts.map((p) => getDocs(query(collection(db, "archives"), where("productionId", "in", p))))
    );
    return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchiveItem, "id">) })));
  })();

  // 자료실: 동일한 접근 규칙
  const audioPromise: Promise<AudioTrack[]> = (async () => {
    if (isAdmin) {
      const snap = await getDocs(collection(db, "audio"));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AudioTrack, "id">) }));
    }
    if (myProdIds.length === 0) return [];
    const parts = chunk(myProdIds, 30);
    const snaps = await Promise.all(
      parts.map((p) => getDocs(query(collection(db, "audio"), where("productionId", "in", p))))
    );
    return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AudioTrack, "id">) })));
  })();

  const [archives, audios] = await Promise.all([archivePromise, audioPromise]);

  const data: Corpus = {
    // 본문 HTML 걷어내기는 글 수에 비례해 무거우므로 코퍼스를 만들 때 한 번만 한다
    posts: postSnap.docs.map((d) => {
      const p = { id: d.id, ...(d.data() as Omit<Post, "id">) };
      return { ...p, _body: stripHtml(p.content ?? "") };
    }),
    events: eventSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleEvent, "id">) })),
    archives,
    audios,
    prodName,
  };

  // 조회 도중 캐시가 비워졌다면(새 글 등록 등) 이 결과는 이미 낡았으므로 캐시에 남기지 않는다
  if (gen === generation) corpusCache = { key, at: Date.now(), data };
  return data;
}

/**
 * 전체 검색. 로그인한 단원의 접근 권한을 그대로 지킴
 * (아카이브·자료실은 참여 작품 자료만, 관리자는 전체).
 */
export async function searchAll(
  q: string,
  opts: { uid: string; isAdmin: boolean }
): Promise<SearchResult[]> {
  const term = q.trim();
  if (!term) return [];
  const { uid, isAdmin } = opts;

  const { posts, events, archives, audios, prodName } = await loadCorpus(uid, isAdmin);

  const out: SearchResult[] = [];

  // ----- 게시판: 제목·내용·작성자 -----
  posts.forEach((p) => {
    if (!hit(term, p.title, p._body, p.authorName, (p.tags ?? []).join(" "))) return;
    out.push({
      id: p.id,
      kind: "board",
      title: p.title || "(제목 없음)",
      sub: excerpt(p.content ?? "", term),
      meta: [p.authorName, p.board].filter(Boolean).join(" · "),
      href: `/board/${p.id}`,
      time: p.createdAt ?? 0,
    });
  });

  // ----- 아카이브: 작품·제목·메모·태그 -----
  for (const a of archives) {
    const pname = a.productionId ? prodName.get(a.productionId) ?? "" : "";
    if (!hit(term, a.title, a.description, pname, (a.tags ?? []).join(" "), a.createdByName)) continue;
    out.push({
      id: a.id,
      kind: "archive",
      title: a.title || "(제목 없음)",
      sub: a.description ? excerpt(a.description, term) : pname,
      meta: [pname, a.date].filter(Boolean).join(" · "),
      href: "/archive",
      time: dateOf(a.date) || a.createdAt || 0,
    });
  }

  // ----- 자료실: 제목·메모·작성자 -----
  for (const t of audios) {
    const title = t.title || t.song || "";
    const pname = t.productionId ? prodName.get(t.productionId) ?? "" : "";
    if (!hit(term, title, t.memo, t.addedByName, t.category)) continue;
    out.push({
      id: t.id,
      kind: "audio",
      title: title || "(제목 없음)",
      sub: t.memo ? excerpt(t.memo, term) : pname,
      meta: [t.category || "음원", t.addedByName].filter(Boolean).join(" · "),
      href: "/audio",
      time: t.createdAt ?? 0,
    });
  }

  // ----- 일정: 제목·장소·메모 -----
  events.forEach((e) => {
    if (!hit(term, e.title, e.location, e.memo, e.team)) return;
    const timeStr = e.startTime ? `${e.startTime}${e.endTime ? `~${e.endTime}` : ""}` : "";
    out.push({
      id: e.id,
      kind: "event",
      title: e.title || "(제목 없음)",
      sub: [e.location, e.memo].filter(Boolean).join(" · ") || undefined,
      meta: [e.date, timeStr].filter(Boolean).join(" "),
      href: `/schedule?tab=events&date=${e.date}&event=${e.id}`,
      time: dateOf(e.date),
    });
  });

  // 최신순
  out.sort((a, b) => b.time - a.time);
  return out;
}
