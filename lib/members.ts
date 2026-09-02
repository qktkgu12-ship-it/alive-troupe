"use client";

// 단원 공개 프로필 명단 — 한 번 받아서 여러 화면이 나눠 쓴다.
//
// 아바타·이름·팀은 일정 카드, 참여인원 선택, 응답 진행률 등 거의 모든 화면에서 필요하다.
// 그런데 화면·시트마다 따로 getDocs(publicProfiles)를 하면
// 같은 명단을 한 세션에 대여섯 번 받아 온다 (Firestore는 문서 단위로 과금한다).
//
// 그래서 여기서 한 번만 받아 캐시하고, 같은 순간에 여러 곳이 부르면
// 진행 중인 요청 하나를 같이 기다리게 한다.

import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { PublicProfile } from "@/lib/types";

export type MemberProfile = PublicProfile & { uid: string };

// 프로필이 바뀌어도 몇 분 늦게 반영되는 건 괜찮다 (이름·사진 정도).
const TTL_MS = 5 * 60 * 1000;

let cache: MemberProfile[] | null = null;
let cachedAt = 0;
let inflight: Promise<MemberProfile[]> | null = null;

/**
 * 단원 명단을 이름순으로 돌려준다.
 * @param force true면 캐시를 무시하고 다시 받는다 (프로필을 고친 직후 등)
 */
export async function getMembers(force = false): Promise<MemberProfile[]> {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  // 이미 받는 중이면 그 요청을 같이 기다린다 (동시에 열린 시트들이 각자 부르는 걸 막는다)
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const snap = await getDocs(collection(db, "publicProfiles"));
      const list = snap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as PublicProfile) }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko"));
      cache = list;
      cachedAt = Date.now();
      return list;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 명단이 바뀌었을 때(프로필 수정·단원 승인 등) 다음 호출에서 다시 받게 한다. */
export function invalidateMembers(): void {
  cache = null;
  cachedAt = 0;
}
