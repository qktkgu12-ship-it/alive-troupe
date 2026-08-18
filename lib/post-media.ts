"use client";

// 게시글 본문에 '글자처럼' 끼워 넣는 사진.
//
// 사진은 base64라 한 장에 100~200KB쯤 된다. Firestore 문서 한 개는 1MB가 최대라
// 글 문서나 사진 문서 하나에 몰아 담으면 서너 장에서 바로 한도에 걸린다.
// 그래서 사진 한 장을 문서 한 개로 나눠 담는다 — postMedia/{글id}/items/{사진id}
//
// 본문 HTML에는 <img data-mid="사진id">만 남기므로 글 문서는 계속 가볍다.
// 화면에 보일 때 data-mid를 실제 사진으로 바꿔 끼운다.

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** 사진id → data URL */
export type MediaMap = Record<string, string>;

export const MAX_IMAGES = 10;

function itemsCol(postId: string) {
  return collection(db, "postMedia", postId, "items");
}

/** 본문에서 실제로 쓰이고 있는 사진 id 목록 (등장 순서대로) */
export function usedMediaIds(html: string): string[] {
  const ids: string[] = [];
  const re = /<img[^>]*\bdata-mid=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ""))) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

/** 본문의 <img data-mid> 에 실제 사진을 끼워 넣는다 (편집·보기 공용) */
export function hydrateMedia(html: string, media: MediaMap): string {
  if (typeof document === "undefined") return html || "";
  const root = document.createElement("div");
  root.innerHTML = html || "";
  root.querySelectorAll("img[data-mid]").forEach((el) => {
    const src = media[el.getAttribute("data-mid") || ""];
    // 아직 못 불러온 사진은 자리만 비워 둔다 (깨진 이미지 아이콘 방지)
    if (src) el.setAttribute("src", src);
    else el.removeAttribute("src");
  });
  return root.innerHTML;
}

/** 글에 딸린 사진을 모두 읽어 온다. 구버전(postMedia/{id}.images)도 같이 본다. */
export async function loadPostMedia(postId: string): Promise<{ media: MediaMap; legacy: string[] }> {
  const [snap, legacyDoc] = await Promise.all([
    getDocs(itemsCol(postId)),
    getDoc(doc(db, "postMedia", postId)),
  ]);
  const media: MediaMap = {};
  snap.forEach((d) => {
    const data = d.data() as { data?: string };
    if (data.data) media[d.id] = data.data;
  });
  // 구버전 글: 본문 밖 갤러리로 붙던 사진들
  const legacy = legacyDoc.exists() ? ((legacyDoc.data() as { images?: string[] }).images ?? []) : [];
  return { media, legacy };
}

/**
 * 본문에서 쓰이는 사진만 저장하고, 빠진 사진은 지운다.
 * (글을 고치면서 사진을 지웠으면 서버에서도 없어져야 한다)
 */
export async function savePostMedia(postId: string, html: string, media: MediaMap, authorUid: string) {
  const keep = usedMediaIds(html);
  const existing = await getDocs(itemsCol(postId));
  const had = new Set(existing.docs.map((d) => d.id));

  // 문서 하나당 사진 한 장 — 배치는 500개까지라 10장은 한 번에 들어간다
  const batch = writeBatch(db);
  keep.forEach((mid, order) => {
    if (had.has(mid)) return; // 이미 올라가 있는 사진은 그대로 둔다
    const src = media[mid];
    if (!src) return;
    batch.set(doc(db, "postMedia", postId, "items", mid), { data: src, order, authorUid });
  });
  had.forEach((mid) => {
    if (!keep.includes(mid)) batch.delete(doc(db, "postMedia", postId, "items", mid));
  });
  await batch.commit();
}

/** 글을 지울 때 딸린 사진도 정리 */
export async function deletePostMedia(postId: string) {
  const snap = await getDocs(itemsCol(postId));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  await deleteDoc(doc(db, "postMedia", postId)).catch(() => {});
}

/** 사진 문서를 미리 만들어 두는 용도 (임시 저장 등) */
export async function putMediaItem(postId: string, mid: string, dataUrl: string, authorUid: string) {
  await setDoc(doc(db, "postMedia", postId, "items", mid), { data: dataUrl, order: 0, authorUid });
}
