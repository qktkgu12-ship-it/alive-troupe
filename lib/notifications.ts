// 알림 계산 로직
// 별도 서버(클라우드 함수)가 없으므로, "내가 알림을 켠 시점(since) 이후 ~ 최근 30일" 사이에
// 새로 생긴 항목을 그때그때 모아서 보여준다. (알림 문서를 따로 저장하지 않음)

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  type ArchiveItem,
  type AudioTrack,
  type Comment,
  type Post,
  type Production,
  type ScheduleEvent,
  type UserProfile,
} from "./types";

const DAY = 86_400_000;

export type NotifType =
  | "event"
  | "archive"
  | "audio"
  | "like"
  | "comment"
  | "notice"
  | "approval";

export interface AppNotification {
  id: string; // 안정적인 고유 ID (읽음 처리 기준)
  type: NotifType;
  title: string; // 첫 줄
  sub?: string; // 둘째 줄(보조 설명)
  time: number; // createdAt
  href: string; // 누르면 이동할 경로
}

interface LikeDoc {
  postId: string;
  uid: string;
  name?: string;
  createdAt?: number;
}

async function safe(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.warn("[알림] 일부 항목을 불러오지 못했어요", e);
  }
}

export async function fetchNotifications({
  uid,
  isAdmin,
  since,
}: {
  uid: string;
  isAdmin: boolean;
  since: number;
}): Promise<AppNotification[]> {
  // 알림 켠 시점 이후, 단 최근 30일은 넘지 않도록(오래된 건 자동으로 빠짐)
  const cutoff = Math.max(since, Date.now() - 30 * DAY);
  const out: AppNotification[] = [];

  // ---------- 확정 일정 ----------
  await safe(async () => {
    const snap = await getDocs(
      query(collection(db, "events"), where("createdAt", ">", cutoff))
    );
    snap.forEach((d) => {
      const e = d.data() as ScheduleEvent;
      out.push({
        id: `event_${d.id}`,
        type: "event",
        title: `새 확정 일정: ${e.title}`,
        sub: e.date + (e.location ? ` · ${e.location}` : ""),
        time: e.createdAt,
        href: `/schedule?tab=events&event=${d.id}&date=${e.date}`,
      });
    });
  });

  // ---------- 아카이브 / 음원 (참여 작품 기준) ----------
  let pids: string[] = [];
  if (!isAdmin) {
    await safe(async () => {
      const snap = await getDocs(
        query(collection(db, "productions"), where("participants", "array-contains", uid))
      );
      pids = snap.docs.map((d) => d.id).slice(0, 10); // in 쿼리 한도
    });
  }

  // 아카이브
  await safe(async () => {
    let items: { id: string; data: ArchiveItem }[] = [];
    if (isAdmin) {
      const snap = await getDocs(
        query(collection(db, "archives"), where("createdAt", ">", cutoff))
      );
      items = snap.docs.map((d) => ({ id: d.id, data: d.data() as ArchiveItem }));
    } else if (pids.length) {
      const snap = await getDocs(
        query(collection(db, "archives"), where("productionId", "in", pids))
      );
      items = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as ArchiveItem }))
        .filter((x) => (x.data.createdAt ?? 0) > cutoff);
    }
    items.forEach(({ id, data: a }) => {
      if (a.createdBy === uid) return; // 내가 올린 건 제외
      out.push({
        id: `archive_${id}`,
        type: "archive",
        title: `아카이브에 새 자료: ${a.title}`,
        sub: a.createdByName || undefined,
        time: a.createdAt,
        href: "/archive",
      });
    });
  });

  // 음원
  await safe(async () => {
    let items: { id: string; data: AudioTrack }[] = [];
    if (isAdmin) {
      const snap = await getDocs(
        query(collection(db, "audio"), where("createdAt", ">", cutoff))
      );
      items = snap.docs.map((d) => ({ id: d.id, data: d.data() as AudioTrack }));
    } else if (pids.length) {
      const snap = await getDocs(
        query(collection(db, "audio"), where("productionId", "in", pids))
      );
      items = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as AudioTrack }))
        .filter((x) => (x.data.createdAt ?? 0) > cutoff);
    }
    items.forEach(({ id, data: a }) => {
      out.push({
        id: `audio_${id}`,
        type: "audio",
        title: `자료실에 새 자료: ${a.title || a.song || ""}`,
        sub: a.category || "음원",
        time: a.createdAt,
        href: "/audio",
      });
    });
  });

  // ---------- 새 공지 ----------
  await safe(async () => {
    const snap = await getDocs(
      query(collection(db, "posts"), where("isNotice", "==", true))
    );
    snap.forEach((d) => {
      const p = d.data() as Post;
      if ((p.createdAt ?? 0) <= cutoff) return;
      if (p.authorUid === uid) return; // 내가 올린 공지는 제외
      out.push({
        id: `notice_${d.id}`,
        type: "notice",
        title: `새 공지: ${p.title}`,
        time: p.createdAt,
        href: `/board/${d.id}`,
      });
    });
  });

  // ---------- 내 글에 달린 좋아요 / 댓글 ----------
  await safe(async () => {
    const snap = await getDocs(
      query(collection(db, "posts"), where("authorUid", "==", uid))
    );
    const myPosts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
    const titleOf = (pid: string) => myPosts.find((p) => p.id === pid)?.title ?? "내 글";

    // 좋아요: postLikes where postId in (10개씩)
    const likedIds = myPosts.filter((p) => (p.likeCount ?? 0) > 0).map((p) => p.id);
    for (let i = 0; i < likedIds.length; i += 10) {
      const chunk = likedIds.slice(i, i + 10);
      const ls = await getDocs(
        query(collection(db, "postLikes"), where("postId", "in", chunk))
      );
      ls.forEach((d) => {
        const l = d.data() as LikeDoc;
        if (!l.createdAt || l.createdAt <= cutoff) return; // 구버전 좋아요(시각 없음) 제외
        if (l.uid === uid) return; // 내가 누른 건 제외
        out.push({
          id: `like_${d.id}`,
          type: "like",
          title: `${l.name || "누군가"}님이 회원님의 글을 좋아합니다`,
          sub: `"${titleOf(l.postId)}"`,
          time: l.createdAt,
          href: `/board/${l.postId}`,
        });
      });
    }

    // 댓글: 댓글이 있는 내 글의 comments where createdAt > cutoff
    const commentedPosts = myPosts.filter((p) => (p.commentCount ?? 0) > 0);
    for (const p of commentedPosts) {
      const cs = await getDocs(
        query(collection(db, "posts", p.id, "comments"), where("createdAt", ">", cutoff))
      );
      cs.forEach((d) => {
        const c = d.data() as Omit<Comment, "id">;
        if (c.authorUid === uid) return; // 내 댓글은 제외
        out.push({
          id: `comment_${p.id}_${d.id}`,
          type: "comment",
          title: `${c.authorName || "누군가"}님이 댓글을 남겼어요`,
          sub: `"${p.title}" · ${c.content}`,
          time: c.createdAt,
          href: `/board/${p.id}`,
        });
      });
    }
  });

  // ---------- (관리자) 가입 승인 요청 ----------
  if (isAdmin) {
    await safe(async () => {
      const snap = await getDocs(
        query(collection(db, "users"), where("role", "==", "guest"))
      );
      snap.forEach((d) => {
        const u = d.data() as UserProfile;
        if ((u.createdAt ?? 0) <= cutoff) return;
        out.push({
          id: `approval_${d.id}`,
          type: "approval",
          title: `새 가입 신청: ${u.name || u.displayName || u.email}`,
          sub: "승인 대기 중",
          time: u.createdAt,
          href: "/admin",
        });
      });
    });
  }

  out.sort((a, b) => b.time - a.time);
  return out.slice(0, 50);
}
